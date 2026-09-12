open Oracle_bytes
let integer text = int_of_string_opt text |> Option.to_result ~none:"bad int"
let raw text = unhex (if String.equal text "-" then "" else text)
let csv text = if String.equal text "-" then [] else String.split_on_char ',' text
let rec traverse f = function [] -> Ok [] | x::xs -> let* y=f x in let* ys=traverse f xs in Ok (y::ys)
let decode codec text = let* bytes=raw text in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let word n = let* bytes=unhex (Printf.sprintf "%064x" n) in U256.of_be_bytes bytes |> Option.to_result ~none:"bad word"
let digest n = let* bytes=unhex (Printf.sprintf "%064x" n) in Tn_keccak.of_stored_bytes bytes |> Option.to_result ~none:"bad hash"
let address n = let* bytes=unhex (Printf.sprintf "%040x" n) in Units.Address.of_bytes bytes |> Option.to_result ~none:"bad address"
let timestamp text = let* value=Int64.of_string_opt text |> Option.to_result ~none:"bad timestamp" in
  Units.Timestamp.of_sec value |> Option.to_result ~none:"bad timestamp"
let committee members epoch =
  let* epoch=integer epoch in
  let* epoch=Units.Epoch.of_int epoch |> Option.to_result ~none:"bad epoch" in
  let* seeds=traverse seed (csv members) in
  let* authorities=List.mapi (fun i seed -> let* execution_address=address (i+1) in
    Ok (Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (Tn_crypto.Secret_key.derive seed)) ~execution_address)) seeds |> traverse Fun.id in
  Committee.create ~epoch authorities |> Result.map_error Committee.error_to_string
let counts_text counter = Rewards_counter.leader_counts counter |> List.map (fun (id,n)->Authority_id.to_hex id ^ ":" ^ string_of_int n ^ ";") |> String.concat ""
let address_text counter = Rewards_counter.address_counts counter |> List.map (fun (a,n)->hex (Units.Address.to_bytes a) ^ ":" ^ string_of_int n ^ ";") |> String.concat ""
let rewards_text counter = String.concat "|" [counts_text counter;address_text counter;
  Rewards_counter.generate_withdrawals counter |> Result.fold ~error:(fun error->"error:" ^ Rewards_counter.error_to_string error)
    ~ok:(fun values->List.map (fun value->hex (Withdrawal.encode_rlp value) ^ ";") values |> String.concat "")]
let hashes_text hashes = List.map (fun hash->Tn_keccak.to_hex hash ^ ";") hashes |> String.concat ""
let committee_text committee = Committee.authorities committee |> List.map (fun authority->Authority_id.to_hex (Authority.id authority) ^ ";") |> String.concat ""
let engine_text state = String.concat "|" [string_of_int (Block_number.to_int (Engine.height state));
  Int64.to_string (Units.Timestamp.to_sec (Engine.frontier state));string_of_bool (Engine.is_sealed state);
  committee_text (Engine.committee state);Int64.to_string (Units.Timestamp.to_sec (Config.epoch_boundary (Engine.config state)));
  committee_text (Config.committee (Engine.config state));Tn_keccak.to_hex (Anchor.hash (Engine.anchor state));
  hashes_text (Recent_hashes.to_list (Engine.recent_hashes state));rewards_text (Engine.rewards state)]
let driver_text (driver : Driver.t) =
  let last=Option.fold ~none:"none" ~some:(fun block->Digests.Output_digest.to_hex (Consensus_block.digest block)) driver.last_forwarded in
  String.concat "|" [Consensus_block.Number.to_string (Driver.last_forwarded driver);last;
    hex (Block_roots.state_root (Engine.world driver.engine));engine_text driver.engine]
let block_text block = String.concat "|" [string_of_int (Block_number.to_int (Executed_block.number block));
  hex (Block_header.encode_rlp (Executed_block.header block));string_of_int (List.length (Executed_block.transactions block));
  string_of_int (List.length (Executed_block.receipts block));string_of_int (List.length (Executed_block.skipped block))]
let advance_text (advance : Outcome.advance) = String.concat "|" [Consensus_block.Number.to_string (Consensus_block.number advance.consensus);
  Digests.Output_digest.to_hex (Consensus_block.digest advance.consensus);string_of_bool advance.closes_epoch;
  String.concat "" (List.map (fun block->"[" ^ block_text block ^ "]") advance.blocks)]
let advances_text advances = String.concat "" (List.map (fun advance->"{" ^ advance_text advance ^ "}") advances)
let outcome_text = function
  | Outcome.Advance {driver;advances} -> String.concat "|" ["advance";driver_text driver;advances_text advances]
  | Outcome.Sealed {driver;advances;rest} -> String.concat "|" ["sealed";driver_text driver;advances_text advances;hex (Bcs.encode (Bcs.list Sub_dag.codec) rest)]
  | Outcome.Halted {advances;error} -> String.concat "|" ["halted";Outcome.error_to_string error;advances_text advances]
let run = function
  | ["fold";members;epoch;time;duration;gas;registry;subdags;bodies;sealed] ->
    let* committee=committee members epoch in let* genesis_timestamp=timestamp time in let* duration=integer duration in
    let* epoch_duration=Chain_spec.Epoch_duration.of_secs duration |> Option.to_result ~none:"bad duration" in
    let* genesis_gas_limit=integer gas in let* registry_code=raw registry in
    let* sub_dags=decode (Bcs.list Sub_dag.codec) subdags in let* bodies=decode (Bcs.list Batch.codec) bodies in
    let* chain_id=word 42 in let* basefee_address=address 9 in let* genesis_hash=digest 1 in let* genesis_base_fee=word 7 in
    let registry=Genesis_account.make ~nonce:Nonce.zero ~balance:U256.zero ~code:(Some registry_code) ~storage:[] in
    let* spec=Chain_spec.create ~chain_id ~basefee_address ~genesis_hash ~genesis_base_fee ~genesis_gas_limit
      ~genesis_timestamp ~epoch_duration ~registry ~extra_alloc:[] () |> Result.map_error Chain_spec.error_to_string in
    let initial=Driver.create spec ~committee in
    let driver=if String.equal sealed "1" then
      {initial with engine={initial.engine with phase=Engine.Sealed {closed_at=Engine.frontier initial.engine;committee}}} else initial in
    let book=Address_book.of_committee committee in
    Ok (outcome_text (Driver.fold driver sub_dags ~bodies:(Batch_store.of_bodies bodies) ~address_of:(Address_book.find book)))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error->"error:" ^ error) (run (String.split_on_char ' ' line))))
