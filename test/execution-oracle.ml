open Oracle_bytes
let ( let* ) = Result.bind
let decode codec text = let* bytes = unhex text in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let number n = Option.to_result ~none:"bad number" (Consensus_block.Number.of_int n)
let block_text block = String.concat ":" [hex (Bcs.encode Consensus_block.codec block); Digests.Output_digest.to_hex (Consensus_block.digest block); hex (Consensus_block.preimage block)]
let replay_text replay = String.concat "/" [Consensus_block.Number.to_string (Replay.after replay); Consensus_block.Number.to_string (Replay.upto replay);
  string_of_int (Replay.length replay); (if Replay.is_empty replay then "1" else "0");
  String.concat "," (List.map (fun block -> Digests.Output_digest.to_hex (Consensus_block.digest block)) (Replay.blocks replay));
  String.concat "," (List.map (fun sd -> Digests.Sub_dag_digest.to_hex (Sub_dag.digest sd)) (Replay.sub_dags replay));
  hex (Bcs.encode (Bcs.list Batch.codec) (Replay.bodies replay));
  Option.fold ~none:"none" ~some:(fun block -> Digests.Output_digest.to_hex (Consensus_block.digest block)) (Replay.last replay)]
let blocks subdags = List.fold_left (fun (chain, blocks) sd -> let chain, block = Consensus_chain.append chain sd in chain, block :: blocks) (Consensus_chain.genesis, []) subdags |> snd |> List.rev
let record_text record = String.concat ":" [Digests.Output_digest.to_hex (Consensus_store.Record.digest record); hex (Bcs.encode (Bcs.list Batch.codec) (Consensus_store.Record.bodies record))]
let store_text store = String.concat "/" [Units.Epoch.to_string (Consensus_store.epoch store); Consensus_block.Number.to_string (Consensus_store.epoch_start store);
  Digests.Output_digest.to_hex (Consensus_store.epoch_parent store); Consensus_block.Number.to_string (Consensus_store.expected_next store);
  string_of_int (Consensus_store.cardinal store); Option.fold ~none:"none" ~some:Consensus_block.Number.to_string (Consensus_store.earliest store);
  Option.fold ~none:"none" ~some:record_text (Consensus_store.latest_received store)]
let store_run subdags bodies actions =
  let blocks = blocks subdags in
  let initial = Consensus_store.create ~epoch:Units.Epoch.zero ~anchor:Consensus_block.Number.genesis ~parent:Consensus_block.genesis_parent in
  let* _, outputs = List.fold_left (fun acc (kind, index) ->
    let* store, outputs = acc in
    let receive block =
      Consensus_store.Record.of_wire (block, bodies) |> Result.fold ~error:(fun e -> store, "body:" ^ Consensus_store.Record.error_to_string e)
        ~ok:(fun record -> Consensus_store.receive store record |> Result.fold ~error:(fun e -> store, "error:" ^ Consensus_store.error_to_string e) ~ok:(fun next -> next, "ok")) in
    let* next, output = match kind with
      | 0 | 6 -> let* block = List.nth_opt blocks index |> Option.to_result ~none:"bad index" in
          let block = if kind = 6 then Consensus_block.create ~parent_hash:Consensus_block.zero_digest ~sub_dag:(Consensus_block.sub_dag block) ~number:(Consensus_block.number block) else block in
          Ok (receive block)
      | 1 -> let* epoch = Units.Epoch.of_int index |> Option.to_result ~none:"bad epoch" in
          Ok (Consensus_store.open_epoch store ~epoch |> Result.fold ~error:(fun e -> store, "error:" ^ Consensus_store.error_to_string e) ~ok:(fun next -> next, "ok"))
      | 2 -> let* n = number index in Ok (store, Consensus_store.record_at store n |> Result.fold ~error:(fun e -> "miss:" ^ Consensus_store.miss_to_string e) ~ok:record_text)
      | 3 -> let* block = List.nth_opt blocks index |> Option.to_result ~none:"bad index" in
          Ok (store, Consensus_store.record_by_digest store (Consensus_block.digest block) |> Option.fold ~none:"none" ~some:record_text)
      | 4 -> Ok (store, Consensus_store.gap store ~after:None |> Result.fold ~error:(fun e -> "miss:" ^ Consensus_store.miss_to_string e) ~ok:replay_text)
      | 5 | 7 -> let* block = List.nth_opt blocks index |> Option.to_result ~none:"bad index" in
          let block = if kind = 7 then Consensus_block.create ~parent_hash:Consensus_block.zero_digest ~sub_dag:(Consensus_block.sub_dag block) ~number:(Consensus_block.number block) else block in
          Ok (store, Consensus_store.gap store ~after:(Some block) |> Result.fold ~error:(fun e -> "miss:" ^ Consensus_store.miss_to_string e) ~ok:replay_text)
      | _ -> Error "bad action" in
    Ok (next, (output ^ "|" ^ store_text next) :: outputs)) (Ok (initial, [])) actions in
  Ok ("trace:" ^ String.concat ";" (List.rev outputs))
let dispatch line = match String.split_on_char ' ' line with
  | ["genesis"] -> Ok (String.concat ":" [Digests.Output_digest.to_hex Consensus_block.genesis_parent; block_text (Consensus_block.create ~parent_hash:Consensus_block.zero_digest ~sub_dag:Consensus_block.default_sub_dag ~number:Consensus_block.Number.genesis)])
  | ["block"; raw] -> let* block = decode Consensus_block.codec raw in Ok (block_text block)
  | ["number"; raw] -> let* n = decode Consensus_block.Number.codec raw in Ok (Consensus_block.Number.to_string n ^ ":" ^ Consensus_block.Number.to_string (Consensus_block.Number.succ n))
  | ["chain"; raw] -> let* subdags = decode (Bcs.list Sub_dag.codec) raw in Ok (String.concat ";" (List.map block_text (blocks subdags)))
  | ["noop"; raw] -> let* subdags = decode (Bcs.list Sub_dag.codec) raw in
      let engine, values = List.fold_left (fun (engine, acc) sd -> Engine.Noop.execute engine sd |> Result.fold ~error:Nothing.absurd ~ok:(fun (engine, more) -> engine, acc @ more)) (Engine.Noop.create (), []) subdags in
      Ok (Consensus_block.Number.to_string (Engine.Noop.height engine) ^ ":" ^ String.concat ";" (List.map block_text values))
  | ["record"; block; bodies] -> let* block = decode Consensus_block.codec block in let* bodies = decode (Bcs.list Batch.codec) bodies in
      Consensus_store.Record.of_wire (block, bodies) |> Result.map record_text |> Result.map_error Consensus_store.Record.error_to_string
  | ["store"; raw; bodies; actions] -> let* subdags = decode (Bcs.list Sub_dag.codec) raw in let* bodies = decode (Bcs.list Batch.codec) bodies in
      let* actions = decode (Bcs.list (Bcs.pair Bcs.u8 Bcs.u32)) actions in store_run subdags bodies actions
  | ["replay"; raw; after; upto; mode; index] ->
      let* subdags = decode (Bcs.list Sub_dag.codec) raw in let blocks = blocks subdags in
      let* after = Option.to_result ~none:"bad after" (int_of_string_opt after) in let* upto = Option.to_result ~none:"bad upto" (int_of_string_opt upto) in
      let* index = Option.to_result ~none:"bad index" (int_of_string_opt index) in let* after_n = number after in let* upto_n = number upto in
      let prior = if after = 0 then None else List.nth_opt blocks (after - 1) in
      let parent = prior |> Option.fold ~none:Consensus_block.genesis_parent ~some:Consensus_block.digest in
      let fetch n = let i = Consensus_block.Number.to_int n - 1 in
        if String.equal mode "hole" && i = index then None else
          List.nth_opt blocks i |> Option.map (fun block ->
            let block = if String.equal mode "link" && i = index then Consensus_block.create ~parent_hash:Consensus_block.zero_digest ~sub_dag:(Consensus_block.sub_dag block) ~number:(Consensus_block.number block) else block in block, []) in
      Replay.collect ~after:after_n ~parent ~upto:upto_n ~fetch |> Result.map replay_text |> Result.map_error Replay.break_to_string
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
