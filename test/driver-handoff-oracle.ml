open Oracle_bytes
open Driver_fixture_helpers
let timestamp_text value = Option.fold ~none:"none" ~some:(fun timestamp->Int64.to_string (Units.Timestamp.to_sec timestamp)) value
let state_text (driver : Driver.t) = Units.Epoch.to_string (Committee.epoch (Engine.committee driver.engine)) ^ "|" ^ driver_text driver
let leaders raw counter =
  let* ids=traverse (fun text -> let* bits=seed text in
    Ok (Authority_id.of_public_key (Tn_crypto.Secret_key.public_key (Tn_crypto.Secret_key.derive bits)))) (csv raw) in
  Ok (List.fold_left Rewards_counter.inc_leader_count counter ids)
let run = function
  | ["handoff";members;epoch;next_members;next_epoch;frontier;duration;sealed;leader_seeds;registry] ->
      let* committee=committee members epoch in
      let* next=Driver_fixture_helpers.committee next_members next_epoch in
      let* frontier=timestamp frontier in let* duration=integer duration in
      let* epoch_duration=Chain_spec.Epoch_duration.of_secs duration |> Option.to_result ~none:"bad duration" in
      let* registry_code=raw registry in
      let* chain_id=word 42 in let* basefee_address=address 9 in let* genesis_hash=digest 1 in let* genesis_base_fee=word 7 in
      let registry=Genesis_account.make ~nonce:Nonce.zero ~balance:U256.zero ~code:(Some registry_code) ~storage:[] in
      let* spec=Chain_spec.create ~chain_id ~basefee_address ~genesis_hash ~genesis_base_fee ~genesis_gas_limit:30000000
        ~genesis_timestamp:Units.Timestamp.zero ~epoch_duration ~registry ~extra_alloc:[] () |> Result.map_error Chain_spec.error_to_string in
      let initial=Driver.create spec ~committee in
      let* rewards=leaders leader_seeds (Engine.rewards initial.engine) in
      let phase=if String.equal sealed "1" then Engine.Sealed {closed_at=frontier;committee} else Engine.Running {boundary=frontier;committee} in
      let driver : Driver.t = {initial with engine={initial.engine with rewards;phase}} in
      let after=Driver.begin_epoch driver ~committee:next |> Result.fold ~ok:state_text ~error:(fun error->"error:" ^ Driver.handoff_error_to_string error) in
      Ok (String.concat "~" [state_text driver;after;timestamp_text (Driver.closed_at driver);timestamp_text (Driver.next_boundary driver)])
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error->"error:" ^ error) (run (String.split_on_char ' ' line))))
