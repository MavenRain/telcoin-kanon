open Oracle_bytes
open Driver_fixture_helpers
let schedule mode cancun prague =
  let* cancun=timestamp cancun in let* prague=timestamp prague in
  match mode with
  | "0" -> Ok Fork_schedule.testnet
  | "1" -> Ok Fork_schedule.mainnet
  | "2" -> Fork_schedule.make ~shanghai:Units.Timestamp.zero ~cancun:(Some cancun) ~prague:None
      |> Result.map_error Fork_schedule.error_to_string
  | _ -> Fork_schedule.make ~shanghai:Units.Timestamp.zero ~cancun:(Some cancun) ~prague:(Some prague)
      |> Result.map_error Fork_schedule.error_to_string
let alloc text = traverse (fun entry -> match String.split_on_char ':' entry with
  | [address;balance;code] ->
      let* address=unhex address in let* address=Units.Address.of_bytes address |> Option.to_result ~none:"bad address" in
      let* balance=unhex balance in let* balance=U256.of_be_bytes balance |> Option.to_result ~none:"bad balance" in
      let* code=unhex code in
      Ok (address,Genesis_account.make ~nonce:Nonce.zero ~balance ~code:(Some code) ~storage:[])
  | [] | _::_ -> Error "bad allocation") (csv text)
let pre_text pre =
  let root=match Block_execution.Pre_block.consensus_root pre with
    | Root_skipped_after_first_batch -> "batch" | Root_skipped_before_cancun -> "shanghai"
    | Root_skipped_at_genesis -> "genesis" | Root_written _ -> "written" in
  let hashes=match Block_execution.Pre_block.blockhashes pre with
    | Hash_skipped_before_prague -> "pre-prague" | Hash_skipped_at_genesis -> "genesis" | Hash_written _ -> "written" in
  root ^ ":" ^ hashes
let details advances = List.concat_map (fun (advance : Outcome.advance) -> advance.blocks) advances
  |> List.map (fun block -> "[" ^ string_of_int (Block_header.timestamp (Executed_block.header block)) ^ ":"
    ^ pre_text (Executed_block.pre_block block) ^ ":" ^ string_of_int (Block_header.gas_used (Executed_block.header block)) ^ ":"
    ^ String.concat "" (List.map (fun bad -> Block_execution.Invalid_tx.to_string bad ^ ";") (Executed_block.skipped block)) ^ "]")
  |> String.concat ""
let describe outcome =
  let advances=match outcome with
    | Outcome.Advance {advances;driver=_} | Outcome.Sealed {advances;driver=_;rest=_}
    | Outcome.Halted {advances;error=_} -> advances in
  outcome_text outcome ^ "#" ^ details advances
let rec store_blocks store chain bodies = function
  | [] -> Ok store
  | dag::tail ->
      let chain,block=Consensus_chain.append chain dag in
      let* record=Consensus_store.Record.create ~consensus:block ~lookup:(Batch_store.find bodies)
        |> Result.map_error Consensus_store.Record.error_to_string in
      let* store=Consensus_store.receive store record |> Result.map_error Consensus_store.error_to_string in
      store_blocks store chain bodies tail
let run = function
  | ["signing-hash";input] ->
      let* bytes=unhex input in let* envelope=Tx_envelope.decode_2718 bytes |> Result.map_error Tx_envelope.error_to_string in
      Ok (hex (Tx_envelope.signature_hash (Tx_envelope.payload envelope)))
  | ["integration";members;dags;bodies;funds;mode;cancun;prague;prefix;registry] ->
      let* committee=committee members "0" in let* dags=decode (Bcs.list Sub_dag.codec) dags in
      let* batches=decode (Bcs.list Batch.codec) bodies in let* extra_alloc=alloc funds in let* prefix=integer prefix in
      let* fork_schedule=schedule mode cancun prague in let* registry_code=raw registry in
      let* chain_id=word 42 in let* basefee_address=address 9 in let* genesis_hash=digest 1 in let* genesis_base_fee=word 7 in
      let* epoch_duration=Chain_spec.Epoch_duration.of_secs 1000 |> Option.to_result ~none:"bad duration" in
      let registry=Genesis_account.make ~nonce:Nonce.zero ~balance:U256.zero ~code:(Some registry_code) ~storage:[] in
      let fork_schedule=if String.equal mode "0" then None else Some fork_schedule in
      let* spec=Chain_spec.create ~chain_id ~basefee_address ~genesis_hash ~genesis_base_fee ~genesis_gas_limit:30000000
        ~genesis_timestamp:Units.Timestamp.zero ~epoch_duration ~registry ~extra_alloc ?fork_schedule ()
        |> Result.map_error Chain_spec.error_to_string in
      let bodies=Batch_store.of_bodies batches in let address_of=Address_book.find (Address_book.of_committee committee) in
      let* store=store_blocks (Consensus_store.create ~epoch:(Committee.epoch committee)
        ~anchor:Consensus_block.Number.genesis ~parent:Consensus_block.genesis_parent) Consensus_chain.genesis bodies dags in
      let live=Driver.fold (Driver.create spec ~committee) (List.filteri (fun i _ -> i<prefix) dags) ~bodies ~address_of in
      let resumed=match live with
        | Outcome.Advance {driver;advances=_} | Outcome.Sealed {driver;advances=_;rest=_} ->
            Driver.resume spec ~committee ~checkpoint:(Driver.snapshot driver) ~store ~address_of
            |> Result.fold ~ok:describe ~error:(fun error -> "error:" ^ Driver.resume_error_to_string error)
        | Outcome.Halted {error;advances=_} -> "setup:" ^ Outcome.error_to_string error in
      Ok (Fork_schedule.to_string (Chain_spec.fork_schedule spec) ^ ":"
        ^ Fork_schedule.to_string (Config.fork_schedule (Chain_spec.engine_config spec ~committee))
        ^ "~" ^ describe live ^ "~" ^ resumed)
  | [] | _::_ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "setup:" ^ error) (run (String.split_on_char ' ' line))))
