open Oracle_bytes
let ( let* ) = Result.bind
let key n = Tn_crypto.Secret_key.derive n
let authority n = Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key n)) ~execution_address:Units.Address.zero
let decode codec raw = Bcs.decode codec raw |> Result.map_error Bcs.error_to_string
let decode_hex codec raw = let* raw = unhex raw in decode codec raw
let raw_certificate header = Certificate.claim ~header ~signers:Authority_id.Set.empty ~aggregate:None |> Option.to_result ~none:"bad fixture"
let header_text h = hex (Bcs.encode Header.codec h)
let digest_text = Digests.Header_digest.to_hex
let certificate_text c = String.concat ":" [header_text (Certificate.header c); String.concat "," (List.map Authority_id.to_hex (Authority_id.Set.elements (Certificate.signers c)));
  Option.fold ~none:"none" ~some:(fun s -> hex (Tn_crypto.Aggregate.to_bytes s)) (Certificate.aggregate_signature c)]
let vote_text v = String.concat ":" [digest_text (Vote.header_digest v); Round.to_string (Vote.round v); Units.Epoch.to_string (Vote.epoch v);
  Authority_id.to_hex (Vote.origin v); Authority_id.to_hex (Vote.author v); hex (Tn_crypto.Signature.to_bytes (Vote.signature v))]
let command_text = function
  | Node.Broadcast_header h -> "h:" ^ header_text h
  | Node.Send_vote { to_; vote } -> "v:" ^ Authority_id.to_hex to_ ^ ":" ^ vote_text vote
  | Node.Send_missing_parents { to_; digests } -> "m:" ^ Authority_id.to_hex to_ ^ ":" ^ String.concat "," (List.map digest_text digests)
  | Node.Broadcast_certificate c -> "c:" ^ certificate_text c
  | Node.Emit_committed sd -> "e:" ^ hex (Bcs.encode Sub_dag.codec sd)
  | Node.Arm_timer { kind; after; gen } ->
      let kind = match kind with Proposer.Min_delay -> "min" | Proposer.Max_delay -> "max" in
      "t:" ^ kind ^ ":" ^ string_of_int gen ^ ":" ^ string_of_int (Units.Duration.to_ms after)
let state_text state commands =
  let snap = Node.snapshot state in
  String.concat "/" [Round.to_string (Dag.committed_round (Node.dag state)); Round.to_string (Dag.gc_round (Node.dag state));
    String.concat "," (List.map (fun c -> digest_text (Certificate.digest c)) snap.certificates);
    Option.fold ~none:"none" ~some:header_text snap.last_proposed;
    String.concat "," (List.map (fun (id, (record : Voter.persisted)) -> Authority_id.to_hex id ^ ":" ^ Round.to_string record.round ^ ":" ^ digest_text record.header_digest) snap.votes);
    String.concat "|" (List.map command_text commands)]
let error_text = function
  | Node.Certificate_equivocation (r, a) -> "equivocation:" ^ Round.to_string r ^ ":" ^ Authority_id.to_hex a
  | Node.Missing_parent d -> "missing:" ^ digest_text d
  | Node.Missing_parent_round r -> "round:" ^ Round.to_string r
let changed_vote header seed mode =
  let v = Vote.sign (key seed) ~voter:(Authority.id (authority seed)) header in
  let digest = if mode = 1 then Digests.Header_digest.zero else Vote.header_digest v in
  let signature = if mode = 2 then Tn_crypto.sign (key 999L) (Vote.signing_message (Header.digest header)) else Vote.signature v in
  Vote.claim ~header_digest:digest ~round:(Vote.round v) ~epoch:(Vote.epoch v) ~origin:(Vote.origin v) ~author:(Vote.author v)
    ~signature:(Tn_crypto.Signature.to_bytes signature) |> Option.to_result ~none:"bad vote fixture"
let append_committed log = function
  | Node.Emit_committed value -> Committed_log.append log value
  | Node.Broadcast_header _ | Node.Send_vote _ | Node.Send_missing_parents _ | Node.Broadcast_certificate _ | Node.Arm_timer _ -> log
let run window depth raw =
  let* window = Option.to_result ~none:"bad window" (int_of_string_opt window) in
  let* gc_depth = Option.to_result ~none:"bad depth" (int_of_string_opt depth) in
  let* committee = Committee.create ~epoch:Units.Epoch.zero (List.init 7 (fun i -> authority (Int64.of_int (i + 1)))) |> Result.map_error Committee.error_to_string in
  let self_id = Authority.id (authority 1L) in
  let secret_key = key 1L in
  let proposer_config = Proposer.config ~min_header_delay:(Proposer.ms 500) ~max_header_delay:(Proposer.ms 1000) ~header_batch_threshold:2 ~max_batches_per_header:2 in
  let initial, boot = Node.create ~committee ~secret_key ~self_id ~proposer_config ~sub_dags_per_schedule:window ~gc_depth ~now:Units.Timestamp.zero in
  let* events = decode_hex (Bcs.list Bcs.bytes) raw in
  let* _, _, outputs = List.fold_left (fun acc raw ->
    let* state, log, outputs = acc in
    let* kind, seconds, payload = decode (Bcs.triple Bcs.u8 Bcs.u64 Bcs.bytes) raw in
    let* now = Option.to_result ~none:"bad timestamp" (Units.Timestamp.of_sec seconds) in
    let* result = match kind with
      | 0 -> let* bytes, worker = decode (Bcs.pair (Bcs.sized_bytes 32) Bcs.u32) payload in
          let* digest = Tn_crypto.Digest.of_bytes bytes |> Option.to_result ~none:"bad digest" in
          let* worker_id = Units.Worker_id.of_int worker |> Option.to_result ~none:"bad worker" in
          Ok (Node.step state ~now (Node.Our_digest { batch = Digests.Batch_digest.of_digest digest; worker_id }))
      | 1 -> let* sender, header, headers = decode (Bcs.triple Bcs.u64 Header.codec (Bcs.list Header.codec)) payload in
          let* parents = List.fold_right (fun h acc -> let* rest = acc in let* c = raw_certificate h in Ok (c :: rest)) headers (Ok []) in
          Ok (Node.step state ~now (Node.Vote_request { from_ = Authority.id (authority sender); header; parents }))
      | 2 -> let* seed, mode = decode (Bcs.pair Bcs.u64 Bcs.u8) payload in
          Option.fold (Node.snapshot state).last_proposed ~none:(Ok (Ok (state, []))) ~some:(fun header ->
            let* vote = changed_vote header seed mode in Ok (Node.step state ~now (Node.Vote_received vote)))
      | 3 -> let* header = decode Header.codec payload in let* certificate = raw_certificate header in Ok (Node.step state ~now (Node.Certificate_received certificate))
      | 4 -> let* kind, gen = decode (Bcs.pair Bcs.u8 Bcs.u32) payload in let kind = if kind = 0 then Proposer.Min_delay else Proposer.Max_delay in
          Ok (Node.step state ~now (Node.Timer_fired { kind; gen }))
      | _ -> Ok (Node.recover ~committee ~secret_key ~self_id ~proposer_config ~sub_dags_per_schedule:window ~gc_depth ~now ~persisted:(Node.snapshot state) ~committed:log) in
    Result.fold result ~error:(fun error -> Ok (state, log, ("error:" ^ error_text error) :: outputs)) ~ok:(fun (next, commands) ->
      let log = List.fold_left append_committed log commands in
      Ok (next, log, state_text next commands :: outputs))) (Ok (initial, Committed_log.empty, [state_text initial boot])) events in
  Ok (String.concat ";" (List.rev outputs))
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  (match String.split_on_char ' ' line with [window; depth; raw] -> run window depth raw | _ -> Error "bad request")
  |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
