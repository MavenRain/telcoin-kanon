open Oracle_bytes
let ( let* ) = Result.bind
let integer text = int_of_string_opt text |> Option.to_result ~none:"bad int"
let timestamp raw =
  let* bits=Int64.of_string_opt raw |> Option.to_result ~none:"bad timestamp" in
  Units.Timestamp.of_sec bits |> Option.to_result ~none:"negative timestamp"
let digest raw = let* bytes=unhex raw in Tn_keccak.of_stored_bytes bytes |> Option.to_result ~none:"bad hash"
let word raw = let* bytes=unhex raw in U256.of_be_bytes bytes |> Option.to_result ~none:"bad word"
let csv raw = if String.equal raw "-" then [] else String.split_on_char ',' raw
let rec traverse f = function [] -> Ok [] | x::xs -> let* y=f x in let* ys=traverse f xs in Ok (y::ys)
let key raw = let* n=seed raw in Ok (Tn_crypto.Secret_key.public_key (Tn_crypto.Secret_key.derive n))
let leader raw = let* public=key raw in Ok (Authority_id.of_public_key public)
let make_committee members shared =
  let* keys=traverse key (csv members) in
  let* authorities=keys |> List.mapi (fun i public ->
    let address=Printf.sprintf "%040x" (if shared then 9 else i+1) in
    let* bytes=unhex address in
    let* execution_address=Units.Address.of_bytes bytes |> Option.to_result ~none:"bad address" in
    Ok (Authority.make ~protocol_key:public ~execution_address)) |> traverse Fun.id in
  Committee.create ~epoch:Units.Epoch.zero authorities |> Result.map_error Committee.error_to_string
let add_leaders counter raw =
  let* leaders=traverse leader (csv raw) in Ok (List.fold_left Rewards_counter.inc_leader_count counter leaders)
let counts_text counter = Rewards_counter.leader_counts counter |> List.map (fun (id,n)->Authority_id.to_hex id ^ ":" ^ string_of_int n ^ ";") |> String.concat ""
let address_text counter = Rewards_counter.address_counts counter |> List.map (fun (a,n)->hex (Units.Address.to_bytes a) ^ ":" ^ string_of_int n ^ ";") |> String.concat ""
let rewards_text counter = String.concat "|" [counts_text counter;address_text counter;
  Rewards_counter.generate_withdrawals counter |> Result.fold
    ~error:(fun error->"error:" ^ Rewards_counter.error_to_string error)
    ~ok:(fun values->List.map (fun value->hex (Withdrawal.encode_rlp value) ^ ";") values |> String.concat "")]
let hashes_text hashes = List.map (fun hash->Tn_keccak.to_hex hash ^ ";") hashes |> String.concat ""
let committee_text committee = Committee.authorities committee |> List.map (fun authority->Authority_id.to_hex (Authority.id authority) ^ ";") |> String.concat ""
let state_text state = String.concat "|" [string_of_int (Block_number.to_int (Engine.height state));
  Int64.to_string (Units.Timestamp.to_sec (Engine.frontier state));string_of_bool (Engine.is_sealed state);
  committee_text (Engine.committee state);Int64.to_string (Units.Timestamp.to_sec (Config.epoch_boundary (Engine.config state)));
  committee_text (Config.committee (Engine.config state));Tn_keccak.to_hex (Anchor.hash (Engine.anchor state));
  hashes_text (Recent_hashes.to_list (Engine.recent_hashes state));rewards_text (Engine.rewards state)]
let dispatch line = match String.split_on_char ' ' line with
  | ["rewards";members;leaders;shared;initial;clear;install] ->
    let* committee=make_committee members (String.equal shared "1") in
    let* initial=integer initial in let* first=leader "1" in
    let base : Rewards_counter.t = {committee=(if String.equal install "1" then Some committee else None);
      counts=Authority_id.Map.singleton first initial} in
    let* counter=add_leaders (if String.equal clear "1" then Rewards_counter.clear base else base) leaders in
    Ok (rewards_text counter)
  | ["recent";newest;ancestors;pushes;current;wanted] ->
    let* newest=digest newest in let* ancestors=traverse digest (csv ancestors) in
    let* pushes=traverse digest (csv pushes) in let* current=word current in let* requested=word wanted in
    let hashes=List.fold_left Recent_hashes.push (Recent_hashes.of_genesis newest ~ancestors) pushes in
    Ok (String.concat "|" [string_of_int (Recent_hashes.depth hashes);Tn_keccak.to_hex (Recent_hashes.newest hashes);
      hashes_text (Recent_hashes.ancestors hashes);hex (U256.to_be_bytes (Block_hashes.lookup (Recent_hashes.window hashes) ~current ~requested))])
  | ["number";raw] ->
    let* number=integer raw in
    let raw64=Int64.of_int number in
    let unsigned=if raw64 < 0L then Z.add (Z.of_int64 raw64) (Z.shift_left Z.one 64) else Z.of_int64 raw64 in
    Ok (String.concat "|" [string_of_int (Block_number.to_int (Block_number.of_int number));
      string_of_int (Block_number.to_int (Block_number.succ (Block_number.of_int number)));Printf.sprintf "%64s" (Z.format "%x" unsigned) |> String.map (function ' ' -> '0' | c -> c)])
  | ["state";members;next;boundary;proposed;sealed;skew;mode] ->
    let* committee=make_committee members false in let* next_committee=make_committee next true in
    let* boundary=timestamp boundary in let* proposed=timestamp proposed in let* mode=integer mode in
    let* hash=digest (Printf.sprintf "%064x" 1) in let* ancestor=digest (Printf.sprintf "%064x" 2) in
    let* skew_hash=digest (Printf.sprintf "%064x" 99) in
    let* base_fee=word (Printf.sprintf "%064x" 7) in let* chain_id=word (Printf.sprintf "%064x" 42) in
    let* address_bytes=unhex (Printf.sprintf "%040x" 9) in
    let* basefee_address=Units.Address.of_bytes address_bytes |> Option.to_result ~none:"bad address" in
    let anchor=Anchor.of_genesis ~hash ~base_fee ~gas_limit:30000000 in
    let config=Config.create ~anchor ~ancestors:[ancestor] ~world:World_state.empty ~chain_id ~basefee_address ~epoch_boundary:boundary ~committee in
    let base=Engine.create config in let* rewards=add_leaders (Engine.rewards base) "1,1,99" in
    let phase=if String.equal sealed "1" then Engine.Sealed {closed_at=boundary;committee} else Engine.phase base in
    let hashes=if String.equal skew "1" then Recent_hashes.of_genesis skew_hash ~ancestors:[ancestor] else Engine.recent_hashes base in
    let state : Engine.t = {base with rewards;phase;hashes} in
    let restored=if mode<2 then state else Engine.resume ~chain_id ~basefee_address (Engine.snapshot state) in
    if mode mod 2=0 then Ok (state_text restored)
    else Engine.begin_epoch restored ~boundary:proposed ~committee:next_committee |> Result.map state_text |> Result.map_error Engine.error_to_string
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text->"error:" ^ text) |> print_endline)
