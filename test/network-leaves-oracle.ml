open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let roundtrip codec bytes = Bcs.decode codec bytes |> Result.fold
  ~error:(fun e -> "error:" ^ Bcs.error_to_string e) ~ok:(fun value -> "ok:" ^ hex (Bcs.encode codec value))
let pair inject project codec equal compare left right = match inject left,inject right with
  | Some a,Some b -> String.concat ":" [hex (Bcs.encode codec a);hex (project a);string_of_bool (equal a b);string_of_int (Int.compare (compare a b) 0)]
  | None,None | None,Some _ | Some _,None -> "none"
let protocol = Result.fold ~error:(fun e -> "error:" ^ Protocols.error_to_string e) ~ok:(fun value -> "ok:" ^ hex value)
let run = function
  | ["decode";kind;value] -> let* bytes=raw value in
    Ok (match kind with
      | "0" -> roundtrip Var_bytes.codec bytes
      | "1" -> roundtrip Bls_public_key.codec bytes
      | "2" -> roundtrip Bls_signature.codec bytes
      | "3" -> roundtrip Wire_scalar.digest bytes
      | "4" -> roundtrip Wire_scalar.header_digest bytes
      | "5" -> roundtrip Wire_scalar.batch_digest bytes
      | "6" -> roundtrip Wire_scalar.authority_id bytes
      | "7" -> roundtrip Wire_scalar.epoch bytes
      | _ -> roundtrip Wire_scalar.round bytes)
  | ["construct";kind;left;right] -> let* left=raw left in let* right=raw right in
    Ok (match kind with
      | "1" -> pair Bls_public_key.of_bytes Bls_public_key.to_bytes Bls_public_key.codec Bls_public_key.equal Bls_public_key.compare left right
      | "2" -> pair Bls_signature.of_bytes Bls_signature.to_bytes Bls_signature.codec Bls_signature.equal Bls_signature.compare left right
      | _ -> pair (fun b -> Some (Var_bytes.of_bytes b)) Var_bytes.to_bytes Var_bytes.codec Var_bytes.equal Var_bytes.compare left right)
  | ["owned";value] -> let* bytes=raw value in Ok (protocol (Protocols.owned_protocol bytes))
  | ["protocols";kind;worker;chain] ->
    let* worker=int_of_string_opt worker |> Option.to_result ~none:"bad worker" in
    let* chain_id=int_of_string_opt chain |> Option.to_result ~none:"bad chain" in
    let node=if String.equal kind "0" then Protocols.Primary else Protocols.Worker worker in
    Ok (String.concat ";" [protocol (Protocols.req_res_protocol ~node ~chain_id);protocol (Protocols.kad_protocol ~node ~chain_id);
      protocol (Protocols.sync_protocol ~node ~chain_id);protocol (Protocols.peer_exchange_protocol ~node ~chain_id);
      hex (Protocols.gossip_protocol_id_prefix ~chain_id)])
  | ["base58";value] -> let* bytes=raw value in Ok (Base58.encode bytes)
  | [] | _::_ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
