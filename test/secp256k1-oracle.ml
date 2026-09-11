open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let z text = Result.map Secp256k1.z_of_be (unhex text)
let nat_text value = "some:" ^ hex (Secp256k1.be32 value)
let dispatch line = match String.split_on_char ' ' line with
  | ["field"; op; modulus; a; b] -> let* op = integer op in let* modulus = z modulus in let* a = z a in let* b = z b in
    let a = Z.erem a modulus in let reduced_b = Z.erem b modulus in
    Ok (match op with
      | 0 -> nat_text a
      | 1 -> nat_text (Z.erem (Z.add a reduced_b) modulus)
      | 2 -> nat_text (Z.erem (Z.sub a reduced_b) modulus)
      | 3 -> nat_text (Z.erem (Z.mul a reduced_b) modulus)
      | 4 -> if Z.equal (Z.gcd a modulus) Z.one then nat_text (Z.invert a modulus) else "none"
      | unknown -> let _ = unknown in nat_text (Z.powm a b modulus))
  | ["recover"; message; id; r; s] -> let* message = unhex message in let* id = integer id in let* r = unhex r in let* s = unhex s in
    Ok (Secp256k1.recover ~msg:message ~recid:id ~r ~s |> Option.fold ~none:"none" ~some:(fun bytes -> "some:" ^ hex bytes))
  | ["high"; s] -> let* s = unhex s in Ok (if Secp256k1.s_is_high s then "1" else "0")
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let vector d k message =
  let z = Secp256k1.z_of_be message in
  match Secp256k1.mul (Z.of_int k) Secp256k1.g_point with
  | Secp256k1.Infinity -> Error "generator multiple is infinity"
  | Secp256k1.Affine (x, y) ->
    let r = Z.erem x Secp256k1.n in
    let s = Z.erem (Z.mul (Z.invert (Z.of_int k) Secp256k1.n) (Z.add z (Z.mul r (Z.of_int d)))) Secp256k1.n in
    Ok (String.concat " " ["recover"; hex message; (if Z.testbit y 0 then "1" else "0"); hex (Secp256k1.be32 r); hex (Secp256k1.be32 s)])
let () = match Array.to_list Sys.argv with
  | [_; "vectors"] -> List.iter (fun (d, k, text) -> vector d k text |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
      [1, 1, String.make 32 '\000'; 2, 2, "abc"; 7, 3, String.make 65 '\255'; 11, 5, String.make 32 '\127']
  | [] -> ()
  | _ :: _ -> In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
