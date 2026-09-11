open Oracle_bytes
module C = Bn254_curve
module F = Bn254_field
module P = Bn254_pairing
let ( let* ) = Result.bind
let bytes2 a = F.Fq.to_be_bytes a.F.Fq2.c0 ^ F.Fq.to_be_bytes a.F.Fq2.c1
let bytes6 a = bytes2 a.F.Fq6.c0 ^ bytes2 a.F.Fq6.c1 ^ bytes2 a.F.Fq6.c2
let bytes12 a = bytes6 a.F.Fq12.c0 ^ bytes6 a.F.Fq12.c1
let encode2 point = Option.fold ~none:(String.make 128 '\000')
  ~some:(fun (x, y) -> F.Fq.to_be_bytes x.F.Fq2.c1 ^ F.Fq.to_be_bytes x.F.Fq2.c0 ^ F.Fq.to_be_bytes y.F.Fq2.c1 ^ F.Fq.to_be_bytes y.F.Fq2.c0) (C.G2.xy point)
let optional encode = Option.fold ~none:"none" ~some:(fun value -> "some:" ^ hex (encode value))
let dispatch line = match String.split_on_char ' ' line with
  | ["g1"; op; left; right] -> let* left = unhex left in let* right = unhex right in
    Ok (optional C.G1.encode (Option.bind (C.G1.decode left) (fun a -> match op with
      | "decode" -> Some a | "neg" -> Some (C.G1.neg a) | "double" -> Some (C.G1.double a)
      | "add" -> Option.map (C.G1.add a) (C.G1.decode right)
      | "mul" -> C.G1.mul (Secp256k1.z_of_be right) a | _ -> None)))
  | ["g2"; op; left; right] -> let* left = unhex left in let* right = unhex right in
    Ok (optional encode2 (Option.bind (C.G2.decode left) (fun a -> match op with
      | "decode" -> Some a | "neg" -> Some (C.G2.neg a) | "double" -> Some (C.G2.double a)
      | "add" -> Option.map (C.G2.add a) (C.G2.decode right)
      | "mul" -> C.G2.mul (Secp256k1.z_of_be right) a | _ -> None)))
  | ["pair"; op; left; right] -> let* left = unhex left in let* right = unhex right in
    Ok (optional bytes12 (Option.bind (C.G1.decode left) (fun p -> Option.bind (C.G2.decode right) (fun q ->
      match op with | "miller" -> Some (P.miller_loop p q) | "final" -> P.pair p q | _ -> None))))
  | ["check"; data] -> let* data = unhex data in
    let rec decode rest pairs = if String.length rest = 0 then Some pairs else if String.length rest < 192 then None else
      Option.bind (C.G1.decode (C.window rest ~off:0 ~len:64)) (fun p ->
      Option.bind (C.G2.decode (C.window rest ~off:64 ~len:128)) (fun q ->
      decode (C.window rest ~off:192 ~len:(String.length rest - 192)) ((p, q) :: pairs))) in
    Ok (Option.fold ~none:"none" ~some:(fun pairs -> if P.pairing_check pairs then "1" else "0") (decode data []))
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let () = match Array.to_list Sys.argv with
  | [_; "vectors"] -> List.iter (fun scalar ->
    let k = Z.of_int scalar in
    Option.iter (fun point -> Printf.printf "g1 %d %s\n" scalar (hex (C.G1.encode point))) (C.G1.mul k C.G1.generator);
    Option.iter (fun point -> Printf.printf "g2 %d %s\n" scalar (hex (encode2 point))) (C.G2.mul k C.G2.generator)) [0; 1; 2; 3; 7]
  | [] -> () | _ :: _ -> In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
