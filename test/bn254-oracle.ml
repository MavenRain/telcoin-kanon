open Oracle_bytes
module F = Bn254_field
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let q text = let* bytes = unhex text in Ok (F.Fq.of_z (Secp256k1.z_of_be bytes))
let q2 bytes offset = F.Fq2.make
  (F.Fq.of_z (Secp256k1.z_of_be (Bn254_curve.window bytes ~off:offset ~len:32)))
  (F.Fq.of_z (Secp256k1.z_of_be (Bn254_curve.window bytes ~off:(offset + 32) ~len:32)))
let q6 bytes offset = F.Fq6.make (q2 bytes offset) (q2 bytes (offset + 64)) (q2 bytes (offset + 128))
let q12 bytes = F.Fq12.make (q6 bytes 0) (q6 bytes 192)
let bytes2 a = F.Fq.to_be_bytes a.F.Fq2.c0 ^ F.Fq.to_be_bytes a.F.Fq2.c1
let bytes6 a = bytes2 a.F.Fq6.c0 ^ bytes2 a.F.Fq6.c1 ^ bytes2 a.F.Fq6.c2
let bytes12 a = bytes6 a.F.Fq12.c0 ^ bytes6 a.F.Fq12.c1
let optional encode = Option.fold ~none:"none" ~some:(fun value -> "some:" ^ hex (encode value))
let dispatch line = match String.split_on_char ' ' line with
  | ["field"; degree; op; left; right; exponent] ->
    let* degree = integer degree in let* op = integer op in let* left = unhex left in let* right = unhex right in let* exponent = integer exponent in
    let power = Z.of_int exponent in
    Ok (match degree with
    | 2 -> let a = q2 left 0 and b = q2 right 0 in optional bytes2 (match op with
      | 0 -> Some (F.Fq2.add a b) | 1 -> Some (F.Fq2.sub a b) | 2 -> Some (F.Fq2.mul a b)
      | 3 -> F.Fq2.inv a | 4 -> F.Fq2.pow a power | 5 -> Some (F.Fq2.frobenius exponent a)
      | 6 -> Some (F.Fq2.conjugate a) | _ -> Some (F.Fq2.neg a))
    | 6 -> let a = q6 left 0 and b = q6 right 0 in optional bytes6 (match op with
      | 0 -> Some (F.Fq6.add a b) | 1 -> Some (F.Fq6.sub a b) | 2 -> Some (F.Fq6.mul a b)
      | 3 -> F.Fq6.inv a | 5 -> Some (F.Fq6.frobenius exponent a)
      | 6 -> Some (F.Fq6.mul_by_v a) | _ -> Some (F.Fq6.neg a))
    | 12 -> let a = q12 left and b = q12 right in optional bytes12 (match op with
      | 0 -> Some (F.Fq12.make (F.Fq6.add a.c0 b.c0) (F.Fq6.add a.c1 b.c1))
      | 1 -> Some (F.Fq12.make (F.Fq6.sub a.c0 b.c0) (F.Fq6.sub a.c1 b.c1)) | 2 -> Some (F.Fq12.mul a b)
      | 3 -> F.Fq12.inv a | 4 -> F.Fq12.pow a power | 5 -> Some (F.Fq12.frobenius exponent a)
      | 6 -> Some (F.Fq12.conjugate a) | _ -> Some (F.Fq12.make (F.Fq6.neg a.c0) (F.Fq6.neg a.c1)))
    | _ -> "bad degree")
  | ["decode"; bytes] -> let* bytes = unhex bytes in Ok (optional F.Fq.to_be_bytes (F.Fq.of_be_bytes bytes))
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let constants () = List.iter (fun (name, table) -> List.iteri (fun i value ->
  Printf.printf "%s %d %s %s\n" name i (Z.to_string (F.Fq.to_z value.F.Fq2.c0)) (Z.to_string (F.Fq.to_z value.F.Fq2.c1))) table)
  ["bnFrob6C1", F.frobenius_fp6_c1; "bnFrob6C2", F.frobenius_fp6_c2; "bnFrob12C1", F.frobenius_fp12_c1]
let () = match Array.to_list Sys.argv with
  | [_; "constants"] -> constants ()
  | [] -> () | _ :: _ -> In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
