open Oracle_bytes
let ( let* ) = Result.bind
let outcome = function
  | Precompile.Succeeded { gas_used; output } -> "s:" ^ string_of_int gas_used ^ ":" ^ hex output
  | Precompile.Rejected -> "rejected" | Precompile.Not_a_precompile -> "not-precompile"
let dispatch line = match String.split_on_char ' ' line with
  | [gas; bytes] -> let* gas_limit = Option.to_result ~none:"bad int" (int_of_string_opt gas) in let* input = unhex bytes in
    Ok (outcome (Precompile.ecrecover ~input ~gas_limit))
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let vector d k message = match Secp256k1.mul (Z.of_int k) Secp256k1.g_point with
  | Secp256k1.Infinity -> Error "generator multiple is infinity"
  | Secp256k1.Affine (x, y) ->
    let r = Z.erem x Secp256k1.n in
    let s = Z.erem (Z.mul (Z.invert (Z.of_int k) Secp256k1.n) (Z.add (Secp256k1.z_of_be message) (Z.mul r (Z.of_int d)))) Secp256k1.n in
    Ok (hex (message ^ Secp256k1.be32 (Z.of_int (if Z.testbit y 0 then 28 else 27)) ^ Secp256k1.be32 r ^ Secp256k1.be32 s))
let () = match Array.to_list Sys.argv with
  | [_; "vectors"] -> List.iter (fun (d, k, byte) -> vector d k (String.make 32 byte) |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
      [1, 1, '\000'; 2, 2, '\171'; 7, 3, '\255'; 11, 5, '\127']
  | [] -> () | _ :: _ -> In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
