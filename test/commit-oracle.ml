open Oracle_bytes
let ( let* ) = Result.bind
let decode codec text = let* bytes = unhex text in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let key n = Tn_crypto.Secret_key.derive n
let authority n = Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key n)) ~execution_address:Units.Address.zero
let roster = List.init 7 (fun i -> authority (Int64.of_int (i + 1)))
let committee () = Committee.create ~epoch:Units.Epoch.zero roster |> Result.map_error Committee.error_to_string
let bool b = if b then "1" else "0"
let score_text scores = String.concat ":" [hex (Bcs.encode Reputation_scores.codec scores); string_of_int (Reputation_scores.total_authorities scores);
  bool (Reputation_scores.all_zero scores); String.concat "," (List.map (fun (id, value) -> Authority_id.to_hex id ^ "=" ^ string_of_int value) (Reputation_scores.by_score_desc scores))]
let subdag_text value = String.concat ":" [hex (Bcs.encode Sub_dag.codec value); hex (Sub_dag.preimage value); Digests.Sub_dag_digest.to_hex (Sub_dag.digest value);
  Printf.sprintf "%Lu" (Units.Sequence_number.to_int64 (Sub_dag.sequence_number value)); Units.Timestamp.to_string (Sub_dag.stored_timestamp value); Units.Timestamp.to_string (Sub_dag.commit_timestamp value);
  String.concat "," (List.map Digests.Batch_digest.to_hex (Sub_dag.payload_digests value))]
let bullshark_run raw window depth recover =
  let* headers = decode (Bcs.list Header.codec) raw in let* committee = committee () in
  let* window = Option.to_result ~none:"bad window" (int_of_string_opt window) in
  let* gc_depth = Option.to_result ~none:"bad depth" (int_of_string_opt depth) in
  let threshold = Leader_schedule.Threshold.default in
  let schedule = Leader_schedule.create committee ~threshold in
  let initial = Bullshark.create ~committee ~schedule ~sub_dags_per_schedule:window ~gc_depth in
  let* _, _, _, outputs = List.fold_left (fun acc header ->
    let* state, log, stored, outputs = acc in
    let* cert = Certificate.claim ~header ~signers:Authority_id.Set.empty ~aggregate:None |> Option.to_result ~none:"bad fixture" in
    Bullshark.process_certificate state cert |> Result.fold
      ~error:(fun error -> Ok (state, log, stored, ("error:" ^ Dag.error_to_string error) :: outputs))
      ~ok:(fun (state, outcome) ->
        let values = match outcome with Bullshark.No_commit _ -> [] | Bullshark.Committed values -> Nonempty.to_list values in
        let log = List.fold_left Committed_log.append log values in
        let stored = cert :: stored in
        let* state = if String.equal recover "1" then
            Bullshark.of_store ~committee ~schedule:(Leader_schedule.from_store committee ~threshold log) ~sub_dags_per_schedule:window ~gc_depth ~certificates:stored ~committed:log
            |> Result.map_error Dag.error_to_string
          else Ok state in
        let output = String.concat "/" [Bullshark.outcome_to_string outcome; Round.to_string (Dag.committed_round (Bullshark.dag state));
          Round.to_string (Dag.gc_round (Bullshark.dag state)); Round.to_string (Bullshark.max_inserted_round state);
          String.concat "," (List.map (fun sd -> hex (Bcs.encode Sub_dag.codec sd)) values)] in
        Ok (state, log, stored, output :: outputs))) (Ok (initial, Committed_log.empty, [], [])) headers in
  Ok (String.concat ";" (List.rev outputs))
let batch_digest_codec = Bcs.iso ~inject:(fun raw -> Digests.Batch_digest.of_digest (Option.value (Tn_crypto.Digest.of_bytes raw) ~default:Tn_crypto.Digest.zero))
  ~project:(fun d -> Tn_crypto.Digest.to_bytes (Digests.Batch_digest.to_digest d)) (Bcs.sized_bytes 32)
let proposer_action = function
  | Proposer.Ack_digest -> "a"
  | Proposer.Broadcast_header header -> "h" ^ hex (Bcs.encode Header.codec header)
  | Proposer.Arm_timer { kind; gen; after } ->
      let kind = match kind with Proposer.Min_delay -> "min" | Proposer.Max_delay -> "max" in
      kind ^ ":" ^ string_of_int gen ^ ":" ^ string_of_int (Units.Duration.to_ms after)
let proposer_text state actions = String.concat "/" [Round.to_string (Proposer.round state);
  hex (Bcs.encode (Bcs.list (Bcs.pair batch_digest_codec Bcs.u32)) (List.map (fun (d, w) -> d, Units.Worker_id.to_int w) (Proposer.pending_digests state)));
  hex (Bcs.encode (Bcs.list Bcs.u32) (List.map Round.to_int (Proposer.proposed_rounds state)));
  Option.fold ~none:"none" ~some:(fun h -> hex (Bcs.encode Header.codec h)) (Proposer.last_proposed state);
  String.concat "," (List.map proposer_action actions)]
let proposer_run initial last events =
  let* committee = committee () in let* round = Option.to_result ~none:"bad round" (int_of_string_opt initial) in
  let* recovered_round = Option.to_result ~none:"bad round" (Round.of_int round) in
  let* last_proposed = if String.equal last "none" then Ok None else let* header = decode Header.codec last in Ok (Some header) in
  let* events = decode (Bcs.list Bcs.bytes) events in
  let schedule = Leader_schedule.create committee ~threshold:Leader_schedule.Threshold.default in
  let config = Proposer.config ~min_header_delay:(Proposer.ms 500) ~max_header_delay:(Proposer.ms 1000) ~header_batch_threshold:2 ~max_batches_per_header:2 in
  let initial, actions = Proposer.recover ~config ~committee ~authority:(Authority.id (authority 1L)) ~schedule ~genesis:(Certificate.genesis committee)
    ~now:Units.Timestamp.zero ~recovered_round ~last_proposed in
  let* _, outputs = List.fold_left (fun acc raw ->
    let* state, outputs = acc in
    let* kind, seconds, payload = Bcs.decode (Bcs.triple Bcs.u8 Bcs.u64 Bcs.bytes) raw |> Result.map_error Bcs.error_to_string in
    let* now = Option.to_result ~none:"bad timestamp" (Units.Timestamp.of_sec seconds) in
    let decode codec = Bcs.decode codec payload |> Result.map_error Bcs.error_to_string in
    let* next, actions = match kind with
      | 0 -> let* batch, worker = decode (Bcs.pair batch_digest_codec Bcs.u32) in
          let* worker_id = Option.to_result ~none:"bad worker" (Units.Worker_id.of_int worker) in Ok (Proposer.step state ~now (Proposer.Our_digest { batch; worker_id }))
      | 1 -> let* r, headers = decode (Bcs.pair Bcs.u32 (Bcs.list Header.codec)) in
          let* round = Option.to_result ~none:"bad round" (Round.of_int r) in
          let* certs = List.fold_right (fun header acc -> let* rest = acc in let* cert = Certificate.claim ~header ~signers:Authority_id.Set.empty ~aggregate:None |> Option.to_result ~none:"bad fixture" in Ok (cert :: rest)) headers (Ok []) in
          Ok (Proposer.step state ~now (Proposer.Parents { certs; round }))
      | 2 | 3 -> let* gen = decode Bcs.u32 in let kind = if kind = 2 then Proposer.Min_delay else Proposer.Max_delay in Ok (Proposer.step state ~now (Proposer.Timer_fired { kind; gen }))
      | 4 -> let* rounds = decode (Bcs.list Bcs.u32) in let* committed = List.fold_right (fun r acc -> let* rest = acc in let* r = Option.to_result ~none:"bad round" (Round.of_int r) in Ok (r :: rest)) rounds (Ok []) in
          Ok (Proposer.step state ~now (Proposer.Committed_headers { committed }))
      | _ -> let* scores = decode Reputation_scores.codec in
          let* activation = Option.to_result ~none:"bad activation" (Leader_round.of_round (Round.succ (Round.succ Round.genesis))) in
          let schedule = Leader_schedule.note_final_scores state.schedule ~activation scores |> Option.value ~default:state.schedule in
          Ok (Proposer.update_schedule state schedule, []) in
    Ok (next, proposer_text next actions :: outputs)) (Ok (initial, [proposer_text initial actions])) events in
  Ok (String.concat ";" (List.rev outputs))
let dispatch line =
  match String.split_on_char ' ' line with
  | ["bullshark"; raw; window; depth; recover] -> bullshark_run raw window depth recover
  | ["proposer"; initial; last; events] -> proposer_run initial last events
  | ["scores"; raw; bumps] -> let* scores = decode Reputation_scores.codec raw in let* values = seeds bumps in
      Ok (score_text (List.fold_left (fun scores n -> Reputation_scores.bump scores (Authority.id (authority n))) scores values))
  | ["schedule"; raw; threshold; rounds] ->
      let* scores = decode Reputation_scores.codec raw in let* committee = committee () in
      let* p = Option.to_result ~none:"bad threshold" (int_of_string_opt threshold) in
      let* threshold = Option.to_result ~none:"bad threshold" (Leader_schedule.Threshold.of_percent p) in
      let* rounds = decode (Bcs.list Bcs.u32) rounds in
      let base = Leader_schedule.create committee ~threshold in
      let* activation = Option.to_result ~none:"bad activation" (Leader_round.of_round (Round.succ (Round.succ Round.genesis))) in
      let changed = Leader_schedule.note_final_scores base ~activation scores in
      let schedule = Option.value changed ~default:base in
      let leaders = List.map (fun round -> Option.bind (Round.of_int round) Leader_round.of_round |> Option.fold ~none:"invalid" ~some:(fun lr -> Authority_id.to_hex (Authority.id (Leader_schedule.leader schedule lr)))) rounds in
      Ok (String.concat "/" [bool (Option.is_some changed); String.concat "," (List.map (fun a -> Authority_id.to_hex (Authority.id a)) (Leader_schedule.good_nodes schedule));
        String.concat "," (List.map Authority_id.to_hex (Authority_id.Set.elements (Leader_schedule.bad_nodes schedule))); String.concat "," leaders])
  | ["subdag"; raw] -> let* value = decode Sub_dag.codec raw in Ok (subdag_text value)
  | ["create"; raw; score_raw; previous; signed] ->
      let* headers = decode (Bcs.list Header.codec) raw in let* scores = decode Reputation_scores.codec score_raw in
      let* seconds = Option.to_result ~none:"bad timestamp" (Int64.of_string_opt previous) in
      let* stored = Option.to_result ~none:"bad timestamp" (Units.Timestamp.of_sec seconds) in
      let* sequence = Nonempty.of_list headers |> Option.to_result ~none:"empty fixture" in
      let previous = Sub_dag.of_persisted ~headers:sequence ~scores ~stored ~randomness:Tn_hash32.Hash32.zero in
      let aggregate = if String.equal signed "1" then Some (Tn_crypto.aggregate [Tn_crypto.sign (key 1L) "commit"; Tn_crypto.sign (key 2L) "commit"]) else None in
      let signers = if String.equal signed "1" then Authority_id.Set.of_list [Authority.id (authority 1L); Authority.id (authority 2L)] else Authority_id.Set.empty in
      let* certs = List.fold_right (fun header acc -> let* rest = acc in let* c = Certificate.claim ~header ~signers ~aggregate:(Option.map Tn_crypto.Aggregate.to_bytes aggregate) |> Option.to_result ~none:"bad fixture" in Ok (c :: rest)) headers (Ok []) in
      let* certs = Nonempty.of_list certs |> Option.to_result ~none:"empty fixture" in
      Ok (subdag_text (Sub_dag.create ~sequence:certs ~scores ~previous:(Some previous)))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
