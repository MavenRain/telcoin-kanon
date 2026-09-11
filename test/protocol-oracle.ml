open Oracle_bytes
module B = Bcs
let bool value = if value then "1" else "0"
let key seed = Tn_crypto.Secret_key.derive seed
let authority seed = Authority.make ~protocol_key:(Tn_crypto.Secret_key.public_key (key seed)) ~execution_address:Units.Address.zero
let committee text = let* values = seeds text in Committee.create ~epoch:Units.Epoch.zero (List.map authority values) |> Result.map_error Committee.error_to_string
let decode codec text = let* raw = unhex text in B.decode codec raw |> Result.map_error B.error_to_string
let vote seed header = Vote.sign (key seed) ~voter:(Authority.id (authority seed)) header
let changed_vote mode header seed =
  let original = vote seed header in
  if mode = "wrong" then
    Vote.claim ~header_digest:Digests.Header_digest.zero ~round:(Vote.round original) ~epoch:(Vote.epoch original)
      ~origin:(Vote.origin original) ~author:(Vote.author original) ~signature:(Tn_crypto.Signature.to_bytes (Vote.signature original))
    |> Option.to_result ~none:"invalid fixture"
  else if mode = "bad" then
    Vote.claim ~header_digest:(Vote.header_digest original) ~round:(Vote.round original) ~epoch:(Vote.epoch original)
      ~origin:(Vote.origin original) ~author:(Vote.author original) ~signature:(Tn_crypto.Signature.to_bytes (Vote.signature (vote 999L header)))
    |> Option.to_result ~none:"invalid fixture"
  else if mode = "metadata" then
    Vote.claim ~header_digest:(Vote.header_digest original) ~round:Round.genesis ~epoch:Units.Epoch.zero
      ~origin:Authority_id.zero ~author:(Vote.author original) ~signature:(Tn_crypto.Signature.to_bytes (Vote.signature original))
    |> Option.to_result ~none:"invalid fixture"
  else Ok original
let dispatch line =
  match String.split_on_char ' ' line with
  | ["batch"; text] -> let* value = decode Batch.codec text in
      Ok ("ok:" ^ hex (Batch.preimage value) ^ ":" ^ Digests.Batch_digest.to_hex (Batch.digest value))
  | ["sealed"; text] -> let* value = decode Batch.Sealed.codec text in
      Ok ("ok:" ^ hex (B.encode Batch.Sealed.codec value) ^ ":" ^ Digests.Batch_digest.to_hex (Batch.Sealed.digest value))
  | ["skip"; text] -> let* value = decode Batch.codec text in
      let updated = Batch.with_received_at value Units.Timestamp.zero in
      Ok (bool (Batch.equal value updated) ^ ":" ^ bool (String.equal (Batch.preimage value) (Batch.preimage updated)) ^ ":" ^ bool (Digests.Batch_digest.equal (Batch.digest value) (Batch.digest updated)))
  | ["header"; text] -> let* value = decode Header.codec text in
      Ok ("ok:" ^ hex (B.encode Header.codec value) ^ ":" ^ Digests.Header_digest.to_hex (Header.digest value))
  | ["block"; text] -> let* value = decode Block_num_hash.codec text in Ok ("ok:" ^ hex (B.encode Block_num_hash.codec value))
  | ["blockCompare"; a; b] -> let* a = decode Block_num_hash.codec a in let* b = decode Block_num_hash.codec b in
      Ok (string_of_int (Int.compare (Block_num_hash.compare a b) 0))
  | ["validate"; text; roster] -> let* header = decode Header.codec text in let* c = committee roster in
      Header.validate c header |> Result.map (fun () -> "ok") |> Result.map_error Header.error_to_string
  | ["vote"; text; seed_text] -> let* header = decode Header.codec text in let* value = seed seed_text in
      let v = vote value header in Ok (hex (Tn_crypto.Signature.to_bytes (Vote.signature v)) ^ ":" ^ hex (Vote.signing_message (Vote.header_digest v)))
  | ["assemble"; text; roster; voters; mode] ->
      let* header = decode Header.codec text in let* c = committee roster in let* values = seeds voters in
      let* votes = List.fold_right (fun s acc -> let* rest = acc in let* v = changed_vote mode header s in Ok (v :: rest)) values (Ok []) in
      let* certificate = Certificate.assemble c header votes |> Result.map_error Certificate.error_to_string in
      let* () = Certificate.check c certificate |> Result.map_error Certificate.error_to_string in
      let aggregate = Certificate.aggregate_signature certificate |> Option.fold ~none:"none" ~some:(fun a -> hex (Tn_crypto.Aggregate.to_bytes a)) in
      Ok ("ok:" ^ Digests.Header_digest.to_hex (Certificate.digest certificate) ^ ":" ^ aggregate)
  | ["claim"; text; roster; signers; aggregate] ->
      let* header = decode Header.codec text in let* c = committee roster in let* values = seeds signers in
      let ids = List.fold_left (fun acc s -> Authority_id.Set.add (Authority.id (authority s)) acc) Authority_id.Set.empty values in
      let* bytes = if aggregate = "none" then Ok None else let* raw = unhex aggregate in Ok (Some raw) in
      let* certificate = Certificate.claim ~header ~signers:ids ~aggregate:bytes |> Option.to_result ~none:"invalid aggregate" in
      Certificate.check c certificate |> Result.map (fun () -> "ok") |> Result.map_error Certificate.error_to_string
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun message -> "error: " ^ message) |> print_endline)
