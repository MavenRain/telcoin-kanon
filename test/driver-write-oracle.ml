open Oracle_bytes
open Driver_fixture_helpers
let latest store = Consensus_store.latest_received store |> Option.fold ~none:"none"
  ~some:(fun record -> Consensus_block.Number.to_string (Consensus_block.number (Consensus_store.Record.consensus record)))
let checkpoint_text checkpoint =
  let accumulator=Checkpoint.accumulator checkpoint in
  String.concat ":" [Consensus_block.Number.to_string (Checkpoint.watermark checkpoint);
    Consensus_block.Number.to_string (Consensus_chain.number accumulator);
    Digests.Output_digest.to_hex (Consensus_chain.parent accumulator);
    Units.Epoch.to_string (Checkpoint.epoch checkpoint);string_of_bool (Checkpoint.is_sealed checkpoint)]
let summary driver store = checkpoint_text (Driver.snapshot driver) ^ "|" ^ latest store
let receive driver dag store bodies =
  let* block=Driver.mint driver dag |> Result.map_error Outcome.error_to_string in
  let* record=Consensus_store.Record.create ~consensus:block ~lookup:(Batch_store.find bodies)
    |> Result.map_error Consensus_store.Record.error_to_string in
  let* store=Consensus_store.receive store record |> Result.map_error Consensus_store.error_to_string in
  Ok (block,store)
let rec write_prefix driver store bodies address_of = function
  | [] -> Ok (driver,store,"")
  | dag::tail ->
      let* block,store=receive driver dag store bodies in
      let* again=Driver.mint driver dag |> Result.map_error Outcome.error_to_string in
      let* next,advance=Driver.step driver dag ~bodies ~address_of |> Result.map_error Outcome.error_to_string in
      let* final,store,rest=write_prefix next store bodies address_of tail in
      let trace=String.concat ":" [Consensus_block.Number.to_string (Driver.last_forwarded driver);
        string_of_bool (Consensus_block.equal block again);string_of_bool (Consensus_block.equal block advance.consensus);
        advance_text advance] in
      Ok (final,store,"{" ^ trace ^ "}" ^ rest)
let resume spec committee checkpoint store address_of =
  Driver.resume spec ~committee ~checkpoint ~store ~address_of
  |> Result.fold ~ok:outcome_text ~error:(fun error -> "error:" ^ Driver.resume_error_to_string error)
let failed spec committee driver store bodies address_of = function
  | [] -> Error "no next output"
  | dag::_ ->
      let* _,store=receive driver dag store bodies in
      let stepped=Driver.step driver dag ~bodies:Batch_store.empty ~address_of
        |> Result.fold ~ok:(fun (_,advance) -> "unexpected-success:" ^ advance_text advance)
          ~error:(fun error -> "error:" ^ Outcome.error_to_string error) in
      Ok (stepped ^ "~" ^ summary driver store ^ "~" ^ resume spec committee (Driver.snapshot driver) store address_of)
let run = function
  | ["write";members;dags;other;bodies;prefix;mode;registry] ->
      let* committee=committee members "0" in
      let* dags=decode (Bcs.list Sub_dag.codec) dags in let* other=decode (Bcs.list Sub_dag.codec) other in
      let* batches=decode (Bcs.list Batch.codec) bodies in let* prefix=integer prefix in let* registry_code=raw registry in
      let* chain_id=word 42 in let* basefee_address=address 9 in let* genesis_hash=digest 1 in let* genesis_base_fee=word 7 in
      let* epoch_duration=Chain_spec.Epoch_duration.of_secs 1000 |> Option.to_result ~none:"bad duration" in
      let registry=Genesis_account.make ~nonce:Nonce.zero ~balance:U256.zero ~code:(Some registry_code) ~storage:[] in
      let* spec=Chain_spec.create ~chain_id ~basefee_address ~genesis_hash ~genesis_base_fee ~genesis_gas_limit:30000000
        ~genesis_timestamp:Units.Timestamp.zero ~epoch_duration ~registry ~extra_alloc:[] () |> Result.map_error Chain_spec.error_to_string in
      let initial=Driver.create spec ~committee in
      let store=Consensus_store.create ~epoch:(Committee.epoch committee) ~anchor:Consensus_block.Number.genesis
        ~parent:Consensus_block.genesis_parent in
      let bodies=Batch_store.of_bodies batches in let address_of=Address_book.find (Address_book.of_committee committee) in
      let take values=List.filteri (fun i _ -> i<prefix) values in
      let* live,received,trace=write_prefix initial store bodies address_of (take dags) in
      let* finish=match mode with
        | "1" -> failed spec committee live received bodies address_of (List.filteri (fun i _ -> i>=prefix) dags)
        | "2" -> let* _,crossed,_=write_prefix initial store bodies address_of (take other) in
            Ok (resume spec committee (Driver.snapshot live) crossed address_of)
        | _ -> Ok (driver_text live) in
      Ok (trace ^ "~" ^ summary live received ^ "~" ^ finish)
  | [] | _::_ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "setup:" ^ error) (run (String.split_on_char ' ' line))))
