open Oracle_bytes
open Driver_fixture_helpers
open Driver_resume_helpers
let registry_addresses = [
  "0033a370616805b1fd275b7ffab83fc41d665ccb";
  "89dab9f6fdc569c1bcdbd6493f25b7040b55dc79";
  "3518b301b86ceb53b5a3dff62e55cd43ef59d024";
  "efaacf04b92298a88200aa50aa6bb7bfce587b17";
  "7489025dfbaad94f2366d88a62989147d9c8b5d3";
]
let registry_committee members epoch =
  let* epoch=Units.Epoch.of_int epoch |> Option.to_result ~none:"bad epoch" in
  let* seeds=traverse seed (csv members) in
  let rec authorities seeds addresses = match seeds,addresses with
    | [],[] -> Ok []
    | s::ss,a::aa ->
      let* bytes=unhex a in
      let* execution_address=Units.Address.of_bytes bytes |> Option.to_result ~none:"bad address" in
      let* rest=authorities ss aa in
      Ok (Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (Tn_crypto.Secret_key.derive s)) ~execution_address :: rest)
    | [],_::_ | _::_,[] -> Error "bad seat count"
  in
  let* members=authorities seeds registry_addresses in
  Committee.create ~epoch members |> Result.map_error Committee.error_to_string
let registry_word text = U256.of_hex text |> Option.to_result ~none:"bad registry word"
let registry_spec () =
  let* balance=registry_word (String.make (64-String.length Registry_genesis.balance_hex) '0' ^ Registry_genesis.balance_hex) in
  let* code=unhex Registry_genesis.code_hex in
  let* storage=traverse (fun (k,v) -> let* k=registry_word k in let* v=registry_word v in Ok (k,v)) Registry_genesis.storage_hex in
  let registry=Genesis_account.make ~nonce:Nonce.zero ~balance ~code:(Some code) ~storage in
  let* chain_id=word 2017 in let* genesis_base_fee=word 7 in
  let* basefee_address=Units.Address.of_bytes (String.make 20 '\190') |> Option.to_result ~none:"bad fee address" in
  let* genesis_timestamp=timestamp "1" in
  let* epoch_duration=Chain_spec.Epoch_duration.of_secs 100 |> Option.to_result ~none:"bad duration" in
  Chain_spec.create ~chain_id ~basefee_address ~genesis_hash:(Tn_keccak.digest "chunk-37 epoch handoff genesis sentinel")
    ~genesis_base_fee ~genesis_gas_limit:30000000 ~genesis_timestamp ~epoch_duration ~registry ~extra_alloc:[] ()
    |> Result.map_error Chain_spec.error_to_string
let handoff closed next tail bodies address_of = match closed with
  | Outcome.Advance {driver=_;advances=_} -> Ok ("setup:unsealed:" ^ outcome_text closed)
  | Outcome.Halted {error=_;advances=_} -> Ok ("setup:" ^ outcome_text closed)
  | Outcome.Sealed {driver;advances=_;rest=_} ->
    let* driver=Driver.begin_epoch driver ~committee:next |> Result.map_error Driver.handoff_error_to_string in
    Ok (outcome_text closed ^ "~" ^ driver_text driver ^ "~" ^ outcome_text (Driver.fold driver tail ~bodies ~address_of))
let run = function
  | ["registry";mode;members;next_members;dags;tail;batches] ->
    let* committee=registry_committee members 0 in let* next=registry_committee next_members 1 in
    let* spec=registry_spec () in
    let* dags=decode (Bcs.list Sub_dag.codec) dags in let* tail=decode (Bcs.list Sub_dag.codec) tail in
    let* batches=decode (Bcs.list Batch.codec) batches in let bodies=Batch_store.of_bodies batches in
    let address_of=Address_book.find (Address_book.union (Address_book.of_committee committee) (Address_book.of_committee next)) in
    if String.equal mode "1" then (
      let* store=store_blocks (Consensus_store.create ~epoch:Units.Epoch.zero ~anchor:Consensus_block.Number.genesis
        ~parent:Consensus_block.genesis_parent) Consensus_chain.genesis bodies dags in
      let* driver=live_driver (Driver.fold (Driver.create spec ~committee) (List.filteri (fun i _ -> i<2) dags) ~bodies ~address_of) in
      let checkpoint=Driver.snapshot driver in
      let resumed=Driver.resume spec ~committee ~checkpoint ~store ~address_of
        |> Result.fold ~ok:outcome_text ~error:(fun error -> "error:" ^ Driver.resume_error_to_string error) in
      Ok (checkpoint_text checkpoint ^ "~" ^ resumed)
    ) else
      let closed=Driver.fold (Driver.create spec ~committee) dags ~bodies ~address_of in
      if String.equal mode "2" then handoff closed next tail bodies address_of else Ok (outcome_text closed)
  | [] | _::_ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "setup:" ^ error) (run (String.split_on_char ' ' line))))
