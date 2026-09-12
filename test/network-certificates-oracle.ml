open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let pair codec rebuild equal left right = Bcs.decode codec left |> Result.fold
  ~error:(fun error -> "error:" ^ Bcs.error_to_string error)
  ~ok:(fun decoded -> let a=rebuild decoded in
    let other=Bcs.decode codec right |> Result.fold ~error:(fun error -> "error:" ^ Bcs.error_to_string error)
      ~ok:(fun b -> string_of_bool (equal a b)) in
    hex (Bcs.encode codec a) ^ ":" ^ string_of_bool (equal a decoded) ^ ":" ^ other)
let rebuild_vote v = Vote_wire.make ~header_digest:(Vote_wire.header_digest v) ~round:(Vote_wire.round v) ~epoch:(Vote_wire.epoch v)
  ~origin:(Vote_wire.origin v) ~author:(Vote_wire.author v) ~signature:(Vote_wire.signature v)
let rebuild_cert v = Certificate_wire.make ~header:(Certificate_wire.header v) ~state:(Certificate_wire.state v) ~signed_authorities:(Certificate_wire.signed_authorities v)
let rebuild_epoch (v : Epoch_certificate.t) = Epoch_certificate.make ~epoch_hash:v.epoch_hash ~signature:v.signature ~signed_authorities:v.signed_authorities
let peer raw = Bcs.decode (Bcs.list (Bcs.pair Bls_public_key.codec Peer_exchange.value_codec)) raw |> Result.fold
  ~error:(fun error -> "error:" ^ Bcs.error_to_string error)
  ~ok:(fun entries -> Peer_exchange.of_entries (List.map (fun (key,(network_key,multiaddrs)) -> Peer_exchange.make_entry ~key ~network_key ~multiaddrs) entries)
    |> Result.fold ~error:(fun error -> "error:" ^ Peer_exchange.error_to_string error)
      ~ok:(fun p -> hex (Bcs.encode Peer_exchange.codec p) ^ ":" ^ string_of_int (List.length (Peer_exchange.entries p))
        ^ ":" ^ string_of_bool (Peer_exchange.equal p Peer_exchange.empty)))
let key = Tn_crypto.Secret_key.derive
let authority seed = Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key seed)) ~execution_address:Units.Address.zero
let cert_result = Result.fold ~error:(fun e -> "error:" ^ Certificate_wire.error_to_string e)
  ~ok:(fun c -> "ok:" ^ hex (Bcs.encode Header.codec (Certificate.header c)) ^ "|"
    ^ hex (String.concat "" (List.map Authority_id.to_bytes (Authority_id.Set.elements (Certificate.signers c)))))
let vote_result = Result.fold ~error:(fun e -> "error:" ^ Vote_wire.error_to_string e) ~ok:(fun v -> "ok:" ^ hex (Tn_crypto.Signature.to_bytes (Vote.signature v)))
let bridge mode seed roster signer_seeds bitmap =
  let* seed=Oracle_bytes.seed seed in let* roster=seeds roster in let* signer_seeds=seeds signer_seeds in
  let* bitmap=raw bitmap in
  let* committee=Committee.create ~epoch:Units.Epoch.zero (List.map authority roster) |> Result.map_error Committee.error_to_string in
  let* round=Round.of_int (if mode="2" then 1 else 0) |> Option.to_result ~none:"round" in
  let header=Header.make ~author:(Authority.id (authority seed)) ~round ~epoch:Units.Epoch.zero
    ~created_at:Units.Timestamp.zero ~payload:[] ~parents:[] ~latest_execution_block:Block_num_hash.zero in
  let* signature=Bls_signature.of_bytes (String.make 48 '\000') |> Option.to_result ~none:"signature" in
  let wire_vote=Vote_wire.make ~header_digest:(Header.digest header) ~round ~epoch:Units.Epoch.zero ~origin:(Header.author header) ~author:(Header.author header) ~signature in
  match mode with
  | "3" -> Ok (vote_result (Vote_wire.to_vote wire_vote))
  | "4" -> Ok (vote_result (Vote_wire.to_verified (Tn_crypto.Secret_key.public_key (key seed)) wire_vote))
  | "5" -> Ok (Vote_wire.of_vote (Vote.sign (key seed) ~voter:(Header.author header) header)
    |> Result.fold ~error:(fun e -> "error:" ^ Vote_wire.error_to_string e) ~ok:(fun v -> "ok:" ^ hex (Bcs.encode Vote_wire.codec v)))
  | "0" | "1" | "2" ->
    let* signed_authorities=Roaring.of_bytes bitmap |> Result.map_error Roaring.error_to_string in
    let state=if mode="1" then Certificate_wire.Unverified signature else Certificate_wire.Genesis in
    Ok (cert_result (Certificate_wire.to_checked committee (Certificate_wire.make ~header ~state ~signed_authorities)))
  | _ ->
    let signers=Authority_id.Set.of_list (List.map (fun seed -> Authority.id (authority seed)) signer_seeds) in
    let aggregate=if mode="6" then None else Some (Tn_crypto.Aggregate.to_bytes
      (Tn_crypto.aggregate (List.map (fun seed -> Vote.signature (Vote.sign (key seed) ~voter:(Authority.id (authority seed)) header)) signer_seeds))) in
    let* c=Certificate.claim ~header ~signers ~aggregate |> Option.to_result ~none:"claim" in
    Ok (Certificate_wire.of_certificate committee c |> Result.fold ~error:(fun e -> "error:" ^ Certificate_wire.error_to_string e)
      ~ok:(fun w -> "ok:" ^ hex (Bcs.encode Certificate_wire.codec w)))
let run = function
  | ["record";kind;left;right] -> let* left=raw left in let* right=raw right in
    Ok (match kind with
    | "0" -> pair Vote_wire.codec rebuild_vote Vote_wire.equal left right
    | "1" -> pair Certificate_wire.state_codec Fun.id Certificate_wire.state_equal left right
    | "2" -> pair Certificate_wire.codec rebuild_cert Certificate_wire.equal left right
    | "3" -> pair Epoch_certificate.codec rebuild_epoch Epoch_certificate.equal left right
    | _ -> pair Peer_exchange.codec Peer_exchange.entries Peer_exchange.equal left right)
  | ["peer";bytes] -> let* bytes=raw bytes in Ok (peer bytes)
  | ["bridge";mode;seed;roster;signers;bitmap] -> bridge mode seed roster signers bitmap
  | ["error";kind;index] -> let* index=int_of_string_opt index |> Option.to_result ~none:"integer" in Ok (match kind with
    | "0" -> Vote_wire.error_to_string Vote_wire.Signature_rejected
    | "1" -> Vote_wire.error_to_string Vote_wire.Does_not_verify
    | "2" -> Certificate_wire.error_to_string (Certificate_wire.Unknown_signer_index {index})
    | "3" -> Certificate_wire.error_to_string Certificate_wire.Signer_not_in_committee
    | _ -> Certificate_wire.error_to_string Certificate_wire.Signature_rejected)
  | [] | _::_ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun e -> "setup:" ^ e) (run (String.split_on_char ' ' line))))
