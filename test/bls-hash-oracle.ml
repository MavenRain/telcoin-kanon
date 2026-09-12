open Oracle_bytes
let raw text = Result.map Bytes.of_string (unhex (if String.equal text "-" then "" else text))
let scalar value = Bytes.to_seq (Bls12_381_signature.sk_to_bytes value) |> List.of_seq |> List.rev |> List.to_seq |> String.of_seq |> hex
let run = function
  | ["hash"; message] -> let* message = raw message in
      Ok (hex (Bytes.to_string (Bls12_381.G1.to_compressed_bytes (Bls12_381.G1.hash_to_curve message Tn_crypto.dst_g1))))
  | ["keygen"; ikm; info] -> let* ikm = raw ikm in let* info = raw info in
      Ok (if Bytes.length ikm < 32 then "none" else scalar (Bls12_381_signature.generate_sk ~key_info:info ikm))
  | ["derive"; value] -> let* value = seed value in Ok (scalar (Tn_crypto.Secret_key.derive value))
  | [] | _ :: _ -> Error "bad operation"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
