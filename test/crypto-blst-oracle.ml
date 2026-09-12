open Oracle_bytes
let raw value = unhex (if String.equal value "-" then "" else value)
let parse decode value = let* value = raw value in Option.to_result ~none:"invalid" (decode value)
let list decode text =
  let pieces = if String.equal text "empty" then [] else String.split_on_char ',' text in
  List.fold_right (fun value acc -> let* value = parse decode value in let* acc = acc in Ok (value :: acc)) pieces (Ok [])
let signed key message =
  let pk = Tn_crypto.Secret_key.public_key key in
  String.concat "|" [hex (Tn_crypto.Public_key.to_bytes pk);hex (Tn_crypto.Signature.to_bytes (Tn_crypto.sign key message));
    hex (Tn_crypto.Digest.to_bytes (Tn_crypto.Digest.hash message))]
let run = function
  | ["zero-sign"; message] -> let* message = raw message in
      let* key = Option.to_result ~none:"zero scalar rejected" (Bls12_381_signature.sk_of_bytes_opt (Bytes.make 32 '\000')) in
      Ok (hex (Tn_crypto.Signature.to_bytes (Tn_crypto.sign key message)))
  | ["hash"; message] -> let* message = raw message in
      Ok (hex (Tn_crypto.Digest.to_bytes (Tn_crypto.Digest.hash message)))
  | ["sign-message"; value; message] -> let* value = seed value in let* message = raw message in
      Ok (hex (Tn_crypto.Signature.to_bytes (Tn_crypto.sign (Tn_crypto.Secret_key.derive value) message)))
  | ["derive"; value; message] -> let* value = seed value in let* message = raw message in
      Ok (signed (Tn_crypto.Secret_key.derive value) message)
  | ["keygen"; ikm; info; message] -> let* ikm = raw ikm in let* info = raw info in let* message = raw message in
      Ok (if String.length ikm < 32 then "none" else signed (Bls12_381_signature.generate_sk ~key_info:(Bytes.of_string info) (Bytes.of_string ikm)) message)
  | ["admit"; kind; value] -> let* value = raw value in
      let admitted = match kind with
        | "pk" -> Option.map Tn_crypto.Public_key.to_bytes (Tn_crypto.Public_key.of_bytes value)
        | "sig" -> Option.map Tn_crypto.Signature.to_bytes (Tn_crypto.Signature.of_bytes value)
        | "agg" -> Option.map Tn_crypto.Aggregate.to_bytes (Tn_crypto.Aggregate.of_bytes value)
        | _ -> None in
      Ok (Option.fold ~none:"none" ~some:hex admitted)
  | ["aggregate"; values] ->
      Ok (Result.fold ~error:(fun _ -> "none") ~ok:(fun signatures -> hex (Tn_crypto.Aggregate.to_bytes (Tn_crypto.aggregate signatures)))
        (list Tn_crypto.Signature.of_bytes values))
  | ["verify"; keys; message; aggregate] -> let* message = raw message in
      let result = let* keys = list Tn_crypto.Public_key.of_bytes keys in let* aggregate = parse Tn_crypto.Aggregate.of_bytes aggregate in
        Ok (Tn_crypto.verify_aggregate keys message aggregate) in
      Ok (string_of_bool (Result.value ~default:false result))
  | ["single"; key; message; signature] -> let* message = raw message in
      let result = let* key = parse Tn_crypto.Public_key.of_bytes key in let* signature = parse Tn_crypto.Signature.of_bytes signature in
        Ok (Tn_crypto.verify key message signature) in
      Ok (string_of_bool (Result.value ~default:false result))
  | ["zero"; key; message; signature] -> let* key = parse Tn_crypto.Public_key.of_bytes key in let* message = raw message in
      let* signature = parse Tn_crypto.Signature.of_bytes signature in
      Ok (String.concat "|" [string_of_bool (Tn_crypto.verify Bls12_381.G2.zero message signature);
        string_of_bool (Tn_crypto.verify_aggregate [key;Bls12_381.G2.zero] message signature)])
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
