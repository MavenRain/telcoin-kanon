open Oracle_bytes
open Driver_fixture_helpers
let rec store_blocks store chain bodies = function
  | [] -> Ok store
  | dag::tail ->
      let chain,block=Consensus_chain.append chain dag in
      let* record=Consensus_store.Record.create ~consensus:block ~lookup:(Batch_store.find bodies)
        |> Result.map_error Consensus_store.Record.error_to_string in
      let* store=Consensus_store.receive store record |> Result.map_error Consensus_store.error_to_string in
      store_blocks store chain bodies tail
let checkpoint_text checkpoint =
  let accumulator=Checkpoint.accumulator checkpoint in
  String.concat ":" [Consensus_block.Number.to_string (Checkpoint.watermark checkpoint);
    Consensus_block.Number.to_string (Consensus_chain.number accumulator);
    Digests.Output_digest.to_hex (Consensus_chain.parent accumulator);
    Units.Epoch.to_string (Checkpoint.epoch checkpoint);string_of_bool (Checkpoint.is_sealed checkpoint)]
let live_driver = function
  | Outcome.Advance {driver;advances=_} | Outcome.Sealed {driver;advances=_;rest=_} -> Ok driver
  | Outcome.Halted {error;advances=_} -> Error (Outcome.error_to_string error)
let run = function
  | ["resume";members;supplied_members;epoch;supplied_epoch;store_epoch;dags;bodies;prefix;sealed;registry] ->
      let* committee=committee members epoch in
      let* supplied=Driver_fixture_helpers.committee supplied_members supplied_epoch in
      let* store_epoch=integer store_epoch in
      let* store_epoch=Units.Epoch.of_int store_epoch |> Option.to_result ~none:"bad store epoch" in
      let* dags=decode (Bcs.list Sub_dag.codec) dags in let* batches=decode (Bcs.list Batch.codec) bodies in
      let* prefix=integer prefix in let* registry_code=raw registry in
      let* chain_id=word 42 in let* basefee_address=address 9 in let* genesis_hash=digest 1 in let* genesis_base_fee=word 7 in
      let* epoch_duration=Chain_spec.Epoch_duration.of_secs 1000 |> Option.to_result ~none:"bad duration" in
      let registry=Genesis_account.make ~nonce:Nonce.zero ~balance:U256.zero ~code:(Some registry_code) ~storage:[] in
      let* spec=Chain_spec.create ~chain_id ~basefee_address ~genesis_hash ~genesis_base_fee ~genesis_gas_limit:30000000
        ~genesis_timestamp:Units.Timestamp.zero ~epoch_duration ~registry ~extra_alloc:[] () |> Result.map_error Chain_spec.error_to_string in
      let bodies=Batch_store.of_bodies batches in
      let* store=store_blocks (Consensus_store.create ~epoch:(Committee.epoch committee)
        ~anchor:Consensus_block.Number.genesis ~parent:Consensus_block.genesis_parent) Consensus_chain.genesis bodies dags in
      let address_of=Address_book.find (Address_book.of_committee committee) in
      let* initial=live_driver (Driver.fold (Driver.create spec ~committee)
        (List.filteri (fun i _ -> i<prefix) dags) ~bodies ~address_of) in
      let phase=if String.equal sealed "1" then Engine.Sealed {closed_at=Engine.frontier initial.engine;committee} else initial.engine.phase in
      let driver : Driver.t = {initial with engine={initial.engine with phase}} in
      let checkpoint=Driver.snapshot driver in
      let* store=if Units.Epoch.equal store_epoch (Consensus_store.epoch store) then Ok store
        else Consensus_store.open_epoch store ~epoch:store_epoch |> Result.map_error Consensus_store.error_to_string in
      let resumed=Driver.resume spec ~committee:supplied ~checkpoint ~store ~address_of
        |> Result.fold ~ok:outcome_text ~error:(fun error -> "error:" ^ Driver.resume_error_to_string error) in
      Ok (checkpoint_text checkpoint ^ "~" ^ resumed)
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "setup:" ^ error) (run (String.split_on_char ' ' line))))
