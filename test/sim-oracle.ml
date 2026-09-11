open Oracle_bytes
let ( let* ) = Result.bind
let key n = Tn_crypto.Secret_key.derive (Int64.of_int n)
let authority n = Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key n)) ~execution_address:Units.Address.zero
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let duration n = Option.to_result ~none:"bad duration" (Units.Duration.of_ms n)
let agreement_text = function
  | Sim.Agree n -> "agree:" ^ string_of_int n
  | Sim.Diverge { left; right; index } -> String.concat ":" ["diverge"; Authority_id.to_hex left; Authority_id.to_hex right; string_of_int index]
let node_error = function
  | Node.Certificate_equivocation (round, id) -> "equivocation:" ^ Round.to_string round ^ ":" ^ Authority_id.to_hex id
  | Node.Missing_parent digest -> "missing:" ^ Digests.Header_digest.to_hex digest
  | Node.Missing_parent_round round -> "round:" ^ Round.to_string round
let render committee sim =
  let log authority =
    let id = Authority.id authority in
    String.concat ":" [Authority_id.to_hex id; hex (Bcs.encode (Bcs.list Sub_dag.codec) (Sim.committed sim id));
      string_of_int (Sim.commit_count sim id);
      String.concat "," (List.map (fun block -> Digests.Output_digest.to_hex (Consensus_block.digest block)) (Sim.executed sim id));
      Option.fold ~none:"none" ~some:(fun block -> Digests.Output_digest.to_hex (Consensus_block.digest block)) (Sim.execution_tip sim id)] in
  String.concat "/" [string_of_int (Units.Duration.to_ms (Sim.elapsed sim)); string_of_int (Sim.steps sim);
    Option.fold ~none:"none" ~some:(fun (id, error) -> Authority_id.to_hex id ^ ":" ^ node_error error) (Sim.error sim);
    agreement_text (Sim.agreement sim); hex (Bcs.encode (Bcs.list Batch.codec) (Sim.batch_bodies sim));
    String.concat ";" (List.map log (Committee.authorities committee))]
let run fields = match fields with
  | [n; seed; horizon; max_steps; lo; hi; drops; crashed; batch_count; period; window; depth] ->
    let* n = integer n in let* seed = Option.to_result ~none:"bad seed" (Int64.of_string_opt seed) in
    let* horizon = integer horizon in let* horizon = duration horizon in let* max_steps = integer max_steps in
    let* lo = integer lo in let* lo = duration lo in let* hi = integer hi in let* hi = duration hi in
    let* drops = integer drops in let* batch_count = integer batch_count in let* period = integer period in let* period = duration period in
    let* window = integer window in let* depth = integer depth in
    let* crashed = if String.equal crashed "empty" then Ok [] else
      List.fold_left (fun acc text -> let* values = acc in let* n = integer text in Ok (Authority.id (authority n) :: values)) (Ok []) (String.split_on_char ',' crashed) in
    let* committee = Committee.create ~epoch:Units.Epoch.zero (List.init n authority) |> Result.map_error Committee.error_to_string in
    let secret_key id = List.init n Fun.id |> List.find_opt (fun i -> Authority_id.equal id (Authority.id (authority i))) |> Option.fold ~none:(key 0) ~some:key in
    let batches = if batch_count = 0 then None else Some (Sim.batch_plan ~per_authority:(batch_count - 1) ~period
      ~worker_id:Units.Worker_id.zero ~epoch:Units.Epoch.zero ~base_fee_per_gas:Units.Base_fee.min_protocol
      ~transactions:(fun id index -> ["tx:" ^ Authority_id.to_bytes id ^ string_of_int index]) ()) in
    let config = Sim.config ~min_latency:lo ~max_latency:hi ~horizon ~max_steps ~seed ~crashed ~drop_permille:drops ?batches () in
    let sim = Sim.create ~committee ~secret_key ~proposer_config:Proposer.default_config ~sub_dags_per_schedule:window ~gc_depth:depth ~config |> Sim.run in
    Ok (render committee sim)
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> run (String.split_on_char ' ' line) |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
