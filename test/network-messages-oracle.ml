open Oracle_bytes
let raw s=unhex (if s="-" then "" else s)
let integer s=int_of_string_opt s |> Option.to_result ~none:"integer"
let pair codec rebuild equal left right=Bcs.decode codec left |> Result.fold ~error:(fun e -> "error:" ^ Bcs.error_to_string e)
  ~ok:(fun decoded -> let value=rebuild decoded in
    let other=Bcs.decode codec right |> Result.fold ~error:(fun e -> "error:" ^ Bcs.error_to_string e) ~ok:(fun v -> string_of_bool (equal value v)) in
    hex (Bcs.encode codec value) ^ ":" ^ string_of_bool (equal value decoded) ^ ":" ^ other)
let kind=function "0"->Gossip.Primary_certificate | "1"->Gossip.Consensus_output | "2"->Gossip.Epoch_vote | _->Gossip.Worker_batch
let kind_text=function Gossip.Primary_certificate->"0" | Gossip.Consensus_output->"1" | Gossip.Epoch_vote->"2" | Gossip.Worker_batch->"3"
let publishers_codec=Bcs.iso ~inject:(Option.fold ~none:Gossip.Open ~some:(fun keys->Gossip.Restricted keys))
  ~project:(function Gossip.Open->None | Gossip.Restricted keys->Some keys) (Bcs.option (Bcs.list Bls_public_key.codec))
let auth_codec=Bcs.pair (Bcs.option Bcs.bytes) (Bcs.pair (Bcs.option Bls_public_key.codec) (Bcs.list (Bcs.pair Bcs.bytes publishers_codec)))
let run=function
  | ["record";tag;left;right] -> let* left=raw left in let* right=raw right in Ok (match tag with
    | "0"->pair Primary_msg.request_codec Fun.id Primary_msg.request_equal left right
    | "1"->pair Primary_msg.response_codec Fun.id Primary_msg.response_equal left right
    | "2"->pair Primary_msg.gossip_codec Fun.id Primary_msg.gossip_equal left right
    | "3"->pair Worker_msg.request_codec Fun.id Worker_msg.request_equal left right
    | "4"->pair Worker_msg.response_codec Fun.id Worker_msg.response_equal left right
    | "5"->pair Worker_msg.gossip_codec Fun.id Worker_msg.gossip_equal left right
    | _->let codec=Primary_msg.missing_certificates_request_codec in
      pair codec (fun (v : Primary_msg.missing_certificates_request) -> Primary_msg.make_missing_certificates_request
        ~exclusive_lower_bound:v.exclusive_lower_bound ~skip_rounds:v.skip_rounds ~max_response_size:v.max_response_size)
        (fun a b->String.equal (Bcs.encode codec a) (Bcs.encode codec b)) left right)
  | ["topic";chain;k;topic] -> let* chain_id=integer chain in let* topic=raw topic in
    Ok (Gossip.topic_of_kind ~chain_id (kind k)^"|"^Option.fold ~none:"none" ~some:kind_text (Gossip.topic_kind ~chain_id topic))
  | ["id";wire] -> let* wire=raw wire in Ok (Bcs.decode (Bcs.pair (Bcs.option Bcs.bytes) (Bcs.option Bcs.u64)) wire |> Result.fold
    ~error:(fun e->"error:"^Bcs.error_to_string e) ~ok:(fun (source,sequence_number)->Gossip.message_id ~source ~sequence_number))
  | ["gossip";chain;topic;wire] -> let* chain_id=integer chain in let* topic=raw topic in let* wire=raw wire in Ok (Gossip.decode ~chain_id ~topic wire |> Result.fold
    ~error:(fun e->"error:"^Gossip.error_to_string e) ~ok:(function
    | Gossip.Primary_payload p->"primary:"^hex (Bcs.encode Primary_msg.gossip_codec p)
    | Gossip.Worker_payload p->"worker:"^hex (Bcs.encode Worker_msg.gossip_codec p)))
  | ["auth";size;topic;wire;resolved] -> let* data_len=integer size in let* topic=raw topic in let* wire=raw wire in let* resolved=integer resolved in
    let* source,(author,authorized)=Bcs.decode auth_codec wire |> Result.map_error Bcs.error_to_string in
    let allowed=Gossip.publisher_allowed ~authorized ~topic ~source ~author in
    let verdict=match Gossip.verify ~data_len ~topic ~source ~author ~authorized with
      | Gossip.Accept->"accept"
      | Gossip.Reject reason->(match reason with Gossip.Too_large->"large" | Gossip.Unauthorized_author->"unauthorized") ^ ":"
        ^ (match Gossip.penalty reason ~relayer_resolved:(resolved mod 2=1) ~author_resolved:(resolved>1) with
          | Gossip.Fatal_relayer->"relayer" | Gossip.Fatal_author->"author" | Gossip.Skip->"skip") in
    Ok (string_of_bool allowed^"|"^verdict)
  | [] | _::_->Error "request"
let ()=In_channel.input_lines stdin |> List.iter (fun line->print_endline
  (Result.fold ~ok:Fun.id ~error:(fun e->"setup:"^e) (run (String.split_on_char ' ' line))))
