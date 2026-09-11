open Oracle_bytes
let key seed = Tn_crypto.Secret_key.derive seed
let public seed = Tn_crypto.Secret_key.public_key (key seed)
let authority seed = Authority.make ~protocol_key:(public seed) ~execution_address:Units.Address.zero
let committee text =
  let* values = seeds text in
  Committee.create ~epoch:Units.Epoch.zero (List.map authority values) |> Result.map_error Committee.error_to_string
let bool value = if value then "1" else "0"
let optional render value = Option.fold ~none:"none" ~some:render value
let ids committee = Committee.authorities committee |> List.map (fun a -> Authority_id.to_hex (Authority.id a)) |> String.concat ","
let dispatch line =
  match String.split_on_char ' ' line with
  | ["key"; text] -> let* value = seed text in Ok (hex (Tn_crypto.Public_key.to_bytes (public value)))
  | ["sign"; text; message] -> let* value = seed text in let* bytes = unhex message in Ok (hex (Tn_crypto.Signature.to_bytes (Tn_crypto.sign (key value) bytes)))
  | ["signature"; text] -> let* bytes = unhex text in Ok (optional (fun s -> hex (Tn_crypto.Signature.to_bytes s)) (Tn_crypto.Signature.of_bytes bytes))
  | ["verify"; text; message; signature] ->
      let* value = seed text in let* bytes = unhex message in let* raw = unhex signature in
      Ok (optional (fun s -> bool (Tn_crypto.verify (public value) bytes s)) (Tn_crypto.Signature.of_bytes raw))
  | ["aggregate"; text; message] ->
      let* values = seeds text in let* bytes = unhex message in
      Ok (hex (Tn_crypto.Aggregate.to_bytes (Tn_crypto.aggregate (List.map (fun s -> Tn_crypto.sign (key s) bytes) values))))
  | ["verifyAggregate"; text; message; aggregate] ->
      let* values = seeds text in let* bytes = unhex message in let* raw = unhex aggregate in
      Ok (optional (fun a -> bool (Tn_crypto.verify_aggregate (List.map public values) bytes a)) (Tn_crypto.Aggregate.of_bytes raw))
  | ["describe"; text] ->
      let* c = committee text in Ok (String.concat ":" [string_of_int (Committee.size c); Units.Stake.to_string (Committee.total_stake c);
        Units.Stake.to_string (Committee.quorum_threshold c); Units.Stake.to_string (Committee.validity_threshold c); ids c])
  | ["nth"; text; index] ->
      let* c = committee text in let* n = Option.to_result ~none:"bad index" (int_of_string_opt index) in
      Ok (Authority_id.to_hex (Authority.id (Committee.nth_mod c n)))
  | ["index"; text; member] ->
      let* c = committee text in let* s = seed member in
      Ok (optional string_of_int (Committee.index_of c (Authority.id (authority s))))
  | ["stake"; text; members] ->
      let* c = committee text in let* selected = seeds members in
      let ids = List.fold_left (fun acc value -> Authority_id.Set.add (Authority.id (authority value)) acc) Authority_id.Set.empty selected in
      Ok (Units.Stake.to_string (Committee.stake_of c ids))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun message -> "error: " ^ message) |> print_endline)
