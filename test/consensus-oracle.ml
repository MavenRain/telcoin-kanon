open Oracle_bytes
let ( let* ) = Result.bind
let bool b = if b then "1" else "0"
let decode codec text = let* bytes = unhex text in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let raw_certificate header = Certificate.claim ~header ~signers:Authority_id.Set.empty ~aggregate:None |> Option.to_result ~none:"invalid certificate fixture"
let certificates text = let* headers = decode (Bcs.list Header.codec) text in
  List.fold_right (fun h acc -> let* rest = acc in let* c = raw_certificate h in Ok (c :: rest)) headers (Ok [])
let certificate_text c = Round.to_string (Certificate.round c) ^ ":" ^ Authority_id.to_hex (Certificate.origin c) ^ ":" ^ Digests.Header_digest.to_hex (Certificate.digest c)
let certificate_list cs = String.concat "," (List.map certificate_text cs)
let dag_state dag = String.concat "/" [Round.to_string (Dag.committed_round dag); Round.to_string (Dag.gc_round dag);
  String.concat "," (List.map Round.to_string (Dag.rounds dag)); certificate_list (Dag.all_certificates dag)]
let key n = Tn_crypto.Secret_key.derive n
let authority n = Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key n)) ~execution_address:Units.Address.zero
let committee csv = let* values = seeds csv in Committee.create ~epoch:Units.Epoch.zero (List.map authority values) |> Result.map_error Committee.error_to_string
let changed_vote header seed mode =
  let v = Vote.sign (key seed) ~voter:(Authority.id (authority seed)) header in
  match mode with
  | 1 -> Vote.claim ~header_digest:Digests.Header_digest.zero ~round:(Vote.round v) ~epoch:(Vote.epoch v)
      ~origin:(Vote.origin v) ~author:(Vote.author v) ~signature:(Tn_crypto.Signature.to_bytes (Vote.signature v)) |> Option.to_result ~none:"invalid fixture"
  | 2 -> Vote.claim ~header_digest:(Vote.header_digest v) ~round:(Vote.round v) ~epoch:(Vote.epoch v)
      ~origin:(Vote.origin v) ~author:(Vote.author v) ~signature:(Tn_crypto.Signature.to_bytes (Tn_crypto.sign (key 999L) (Vote.signing_message (Header.digest header)))) |> Option.to_result ~none:"invalid fixture"
  | _ -> Ok v
let dag_run depth cs actions =
  let step acc (kind, index) =
    let* dag, outputs = acc in
    let* c = List.nth_opt cs index |> Option.to_result ~none:"bad index" in
    let result = match kind with
      | 0 -> Dag.try_insert dag c
      | 1 -> Dag.insert_recovered dag c
      | 2 -> Ok (Dag.update dag c, false)
      | 3 -> Ok (dag, Option.is_some (Dag.get dag (Certificate.round c) (Certificate.origin c)))
      | _ -> Ok (dag, Dag.contains_digest dag (Certificate.digest c)) in
    let next, output = Result.fold result ~error:(fun error -> dag, "error:" ^ Dag.error_to_string error)
      ~ok:(fun (next, relevant) -> next, "ok:" ^ bool relevant) in
    Ok (next, (output ^ "|" ^ dag_state next) :: outputs)
  in
  let* _, outputs = List.fold_left step (Ok (Dag.create ~gc_depth:depth, [])) actions in
  Ok (String.concat ";" (List.rev outputs))
let voter_reason = function
  | Voter.Header_invalid error -> "header:" ^ Header.error_to_string error
  | Voter.Round_zero -> "round_zero"
  | Voter.Invalid_parent_round -> "parent_round"
  | Voter.Inquorate_parents -> "parent_quorum"
  | Voter.Non_monotone_timestamp -> "parent_time"
  | Voter.Future_timestamp -> "future_time"
  | Voter.Already_voted_higher -> "voted_higher"
  | Voter.Equivocating_header -> "equivocation"
let voter_decision = function
  | Voter.Vote vote -> "vote:" ^ hex (Tn_crypto.Signature.to_bytes (Vote.signature vote))
  | Voter.Recast vote -> "recast:" ^ hex (Tn_crypto.Signature.to_bytes (Vote.signature vote))
  | Voter.Need_parents parents -> "need:" ^ String.concat "," (List.map Digests.Header_digest.to_hex parents)
  | Voter.Reject reason -> "reject:" ^ voter_reason reason
let voter_snapshot state = Voter.snapshot state |> List.map (fun (author, (record : Voter.persisted)) ->
  Authority_id.to_hex author ^ ":" ^ Round.to_string record.round ^ ":" ^ Digests.Header_digest.to_hex record.header_digest) |> String.concat ","
let dispatch line = match String.split_on_char ' ' line with
  | ["voter"; roster; stored; requests; clock; recovered] ->
      let* c = committee roster in let* cs = certificates stored in
      let* headers = decode (Bcs.list Header.codec) requests in let* time = seed clock in
      let* now = Units.Timestamp.of_sec time |> Option.to_result ~none:"bad time" in
      let* dag = Dag.recover ~gc_depth:10 ~last_committed_round:Round.genesis ~last_committed:Authority_id.Map.empty ~certificates:cs |> Result.map_error Dag.error_to_string in
      let genesis = Certificate.genesis c in let secret_key = key 1L in let self_id = Authority.id (authority 1L) in
      let initial = Voter.create ~committee:c ~secret_key ~self_id ~genesis in
      let step (state, out) header =
        let next, decision = Voter.vote state ~dag ~now header in
        let output = voter_decision decision ^ "|" ^ bool (Voter.has_voted next (Header.author header) (Header.round header)) ^ "|" ^ voter_snapshot next in
        let next = if recovered = "1" then Voter.recover ~committee:c ~secret_key ~self_id ~genesis ~votes:(Voter.snapshot next) else next in
        next, output :: out in
      let _, outputs = List.fold_left step (initial, []) headers in Ok (String.concat ";" (List.rev outputs))
  | ["dag"; depth; input; actions] -> let* depth = int_of_string_opt depth |> Option.to_result ~none:"bad depth" in
      let* cs = certificates input in let* actions = decode (Bcs.list (Bcs.pair Bcs.u8 Bcs.u32)) actions in dag_run depth cs actions
  | ["recover"; depth; committed; input] ->
      let* depth = int_of_string_opt depth |> Option.to_result ~none:"bad depth" in
      let* n = int_of_string_opt committed |> Option.to_result ~none:"bad round" in
      let* last_committed_round = Round.of_int n |> Option.to_result ~none:"bad round" in
      let* cs = certificates input in
      Dag.recover ~gc_depth:depth ~last_committed_round ~last_committed:Authority_id.Map.empty ~certificates:cs
      |> Result.map dag_state |> Result.map_error Dag.error_to_string
  | ["votes"; roster; input; actions] ->
      let* c = committee roster in let* header = decode Header.codec input in
      let* actions = decode (Bcs.list (Bcs.pair Bcs.u64 Bcs.u8)) actions in
      let step acc (seed, mode) = let* state, out = acc in let* vote = changed_vote header seed mode in
        let next, result = Vote_aggregator.add state c header vote in
        let output = Result.fold result ~error:(fun e -> "error:" ^ Certificate.error_to_string e)
          ~ok:(Option.fold ~none:"none" ~some:(fun cert -> "some:" ^ Digests.Header_digest.to_hex (Certificate.digest cert))) in
        let voters = Authority_id.Set.elements (Vote_aggregator.voters next) |> List.map Authority_id.to_hex |> String.concat "," in
        Ok (next, (output ^ "|" ^ voters) :: out) in
      let* _, outputs = List.fold_left step (Ok (Vote_aggregator.empty, [])) actions in Ok (String.concat ";" (List.rev outputs))
  | ["parents"; roster; input] -> let* c = committee roster in let* cs = certificates input in
      let step (state, out) cert = let next, release = Parent_aggregator.add state c cert in
        let output = Option.fold release ~none:"none" ~some:(fun values -> "some:" ^ certificate_list (Nonempty.to_list values)) in
        let output = output ^ "|" ^ bool (Parent_aggregator.reached_quorum next c) ^ "|" ^ certificate_list (Parent_aggregator.pending next) in
        next, output :: out in
      let _, outputs = List.fold_left step (Parent_aggregator.empty, []) cs in Ok (String.concat ";" (List.rev outputs))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) |> print_endline)
