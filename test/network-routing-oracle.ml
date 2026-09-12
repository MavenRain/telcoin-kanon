open Oracle_bytes
let raw s=unhex (if s="-" then "" else s)
let integer s=int_of_string_opt s |> Option.to_result ~none:"integer"
let decode codec raw=Bcs.decode codec raw |> Result.map_error Bcs.error_to_string
let key=Tn_crypto.Secret_key.derive
let authority seed=Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key seed)) ~execution_address:Units.Address.zero
let committee text=let* roster=seeds text in Committee.create ~epoch:Units.Epoch.zero (List.map authority roster) |> Result.map_error Committee.error_to_string
let cert_text c=hex (Bcs.encode Header.codec (Certificate.header c))^"|"^hex (String.concat "" (List.map Authority_id.to_bytes (Authority_id.Set.elements (Certificate.signers c))))
let unmapped=function
  | Wire.Peer_exchange_request->"peer-request" | Wire.Epoch_record_request->"epoch-request"
  | Wire.Missing_parents_response->"missing-response" | Wire.Epoch_record_response->"epoch-response"
  | Wire.Peer_exchange_response->"peer-response" | Wire.Rpc_error_response->"error-response"
  | Wire.Recoverable_rpc_error_response->"retry-response" | Wire.Consensus_gossip->"consensus"
  | Wire.Epoch_vote_gossip->"epoch-vote" | Wire.Worker_batch_gossip->"worker-batch"
let verdict=Result.fold ~error:(fun e->"error:"^Wire.error_to_string e) ~ok:(function
  | Wire.Not_a_node_event value->"unmapped:"^unmapped value
  | Wire.Event event->match event with
    | Node.Our_digest _->"digest"
    | Node.Vote_request {from_;header;parents}->"request:"^hex (Authority_id.to_bytes from_)^"|"^hex (Bcs.encode Header.codec header)^"|"
      ^String.concat "" (List.map (fun c->cert_text c^";") parents)
    | Node.Vote_received vote->"vote:"^hex (Tn_crypto.Signature.to_bytes (Vote.signature vote))
    | Node.Certificate_received c->"certificate:"^cert_text c
    | Node.Timer_fired _->"timer")
let outbound_text=function
  | Wire.Publish {topic;payload}->"publish:"^hex topic^"|"^hex payload
  | Wire.Request {to_;request}->"request:"^hex (Authority_id.to_bytes to_)^"|"^hex (Bcs.encode Primary_msg.request_codec request)
  | Wire.Response {response}->"response:"^hex (Bcs.encode Primary_msg.response_codec response)
  | Wire.Local->"local"
let run=function
  | ["in";mode;roster;chain;sender;topic;wire] -> let* committee=committee roster in let* chain_id=integer chain in
    let* sender=seed sender in let from_=Authority.id (authority sender) in let* topic=raw topic in let* wire=raw wire in
    (match mode with
    | "0"->let* request=decode Primary_msg.request_codec wire in Ok (verdict (Wire.event_of_request ~committee ~from_ request))
    | "1"->let* response=decode Primary_msg.response_codec wire in Ok (verdict (Wire.event_of_response response))
    | "2"->Ok (verdict (Wire.event_of_gossip ~committee ~chain_id ~topic wire))
    | "3"->let* payload=decode Primary_msg.gossip_codec wire in Ok (verdict (Wire.verdict_of_payload ~committee (Gossip.Primary_payload payload)))
    | _->let* payload=decode Worker_msg.gossip_codec wire in Ok (verdict (Wire.verdict_of_payload ~committee (Gossip.Worker_payload payload))))
  | ["out";mode;roster;chain;seed_text;header;digests;signers] -> let* committee=committee roster in let* chain_id=integer chain in
    let* seed=seed seed_text in let* header=raw header in let* header=decode Header.codec header in
    let* digests=raw digests in let* digests=decode (Bcs.list Wire_scalar.header_digest) digests in let* signer_seeds=seeds signers in
    let signers=Authority_id.Set.of_list (List.map (fun seed->Authority.id (authority seed)) signer_seeds) in
    let aggregate=if mode="6" then Some (Tn_crypto.Aggregate.to_bytes (Tn_crypto.aggregate
      (List.map (fun seed->Vote.signature (Vote.sign (key seed) ~voter:(Authority.id (authority seed)) header)) signer_seeds))) else None in
    let* certificate=Certificate.claim ~header ~signers ~aggregate |> Option.to_result ~none:"certificate" in
    let* after=Units.Duration.of_ms 5 |> Option.to_result ~none:"duration" in
    let command=match mode with
      | "0"->Node.Broadcast_header header
      | "1"->Node.Send_vote {to_=Authority_id.zero;vote=Vote.sign (key seed) ~voter:(Authority.id (authority seed)) header}
      | "2"->Node.Send_missing_parents {to_=Authority_id.zero;digests}
      | "4"->Node.Arm_timer {kind=Proposer.Min_delay;gen=42;after}
      | "5"->Node.Emit_committed (Sub_dag.of_persisted ~headers:(Nonempty.singleton header) ~scores:(Reputation_scores.fresh committee) ~stored:Units.Timestamp.zero ~randomness:Hash32.zero)
      | "7"->Node.Arm_timer {kind=Proposer.Max_delay;gen=42;after}
      | _->Node.Broadcast_certificate certificate in
    Ok (Wire.outbound_of_command ~committee ~chain_id command |> Result.fold ~error:(fun e->"error:"^Wire.error_to_string e)
      ~ok:(fun out->String.concat "" (List.map (fun value->outbound_text value^";") out)))
  | ["retry";header;parents] -> let* header=raw header in let* header=decode Header.codec header in
    let* parents=raw parents in let* parents=decode (Bcs.list Certificate_wire.codec) parents in
    Ok (hex (Bcs.encode Primary_msg.request_codec (Wire.retry_vote_request ~header ~parents)))
  | [] | _::_->Error "request"
let ()=In_channel.input_lines stdin |> List.iter (fun line->print_endline
  (Result.fold ~ok:Fun.id ~error:(fun e->"setup:"^e) (run (String.split_on_char ' ' line))))
