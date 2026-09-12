open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let address text =
  let* bytes = unhex text in
  Option.to_result ~none:"bad address" (Tn_types.Units.Address.of_bytes bytes)
let address_text value = hex (Tn_types.Units.Address.to_bytes value)
let info_text (v : Registry_abi.Validator_info.t) =
  String.concat ":" [address_text v.validator_address; string_of_int v.activation_epoch;
    string_of_int v.exit_epoch; string_of_int (Char.code (Registry_abi.Validator_status.to_byte v.current_status));
    (if v.is_retired then "1" else "0"); string_of_int v.stake_version; string_of_int v.region]
let infos_text infos = String.concat "|" (List.map info_text infos)
let rec parse_list parse = function
  | [] -> Ok []
  | head :: tail -> let* value = parse head in let* rest = parse_list parse tail in Ok (value :: rest)
let csv text = if String.equal text "-" then [] else String.split_on_char ',' text
let reward text = match String.split_on_char ':' text with
  | [addr; count] -> let* addr = address addr in let* count = integer count in Ok (addr, count)
  | [] | _ :: _ -> Error "bad reward"
let eligible = function
  | "0" -> Registry_abi.Eligible_status.Active
  | "1" -> Registry_abi.Eligible_status.Pending_activation
  | _ -> Registry_abi.Eligible_status.Pending_exit
let status n =
  if n < 0 || n > 255 then None
  else Option.bind (Result.to_option (unhex (Printf.sprintf "%02x" n))) (fun bytes ->
    Option.bind (List.find_opt (fun _ -> true) (List.of_seq (String.to_seq bytes))) Registry_abi.Validator_status.of_byte)
let dispatch line = match String.split_on_char ' ' line with
  | ["array"; input] ->
      let* data = unhex input in
      Registry_abi.decode_validator_info_array data |> Result.map_error Registry_abi.error_to_string |> Result.map infos_text
  | ["uint16"; input] ->
      let* data = unhex input in
      Registry_abi.decode_uint16 data |> Result.map_error Registry_abi.error_to_string |> Result.map string_of_int
  | ["status"; input] ->
      let* n = integer input in
      Ok (Option.fold ~none:"none" ~some:(fun s -> string_of_int (Char.code (Registry_abi.Validator_status.to_byte s))) (status n))
  | ["make"; addr; activation; exit; current; retired; stake; region] ->
      let* validator_address = address addr in
      let* activation_epoch = integer activation in let* exit_epoch = integer exit in
      let* current = integer current in let* stake_version = integer stake in let* region = integer region in
      Ok (Option.fold ~none:"none" ~some:info_text (Option.bind (status current) (fun current_status ->
        Registry_abi.Validator_info.make ~validator_address ~activation_epoch ~exit_epoch ~current_status
          ~is_retired:(String.equal retired "1") ~stake_version ~region)))
  | ["selectors"] -> Ok (String.concat "|" (List.map hex [
      Registry_abi.conclude_epoch_selector; Registry_abi.apply_incentives_selector; Registry_abi.get_validators_info_selector;
      Registry_abi.get_validators_selector; Registry_abi.get_next_committee_size_selector]))
  | ["get"; s] -> let s = eligible s in Ok (hex (Registry_abi.get_validators_info_calldata s) ^ "|" ^ hex (Registry_abi.get_validators_calldata s))
  | ["conclude"; values] -> let* values = parse_list address (csv values) in Ok (hex (Registry_abi.conclude_epoch_calldata values))
  | ["rewards"; values] -> let* values = parse_list reward (csv values) in Ok (hex (Registry_abi.apply_incentives_calldata values))
  | ["shuffle"; input; size; seed] ->
      let* input = unhex input in
      let* pool = Registry_abi.decode_validator_info_array input |> Result.map_error Registry_abi.error_to_string in
      let* committee_size = integer size in
      let* seed = unhex seed in let* randomness = Option.to_result ~none:"bad randomness" (Hash32.of_bytes seed) in
      Ok (String.concat "," (List.map address_text (Committee_shuffle.shuffle ~pool ~committee_size ~randomness)))
  | [] | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
