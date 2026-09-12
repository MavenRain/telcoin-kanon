open Oracle_bytes
let raw text = Result.map Bytes.of_string (unhex (if String.equal text "-" then "" else text))
let reverse text = String.of_seq (List.to_seq (List.rev (List.of_seq (String.to_seq text))))
let reverse_fields text =
  let rec split count chars acc = match count,chars with
    | 0,_ | _,[] -> acc,chars | count,char :: tail -> split (count-1) tail (char :: acc) in
  let rec loop chars acc = match chars with
    | [] -> String.concat "" (List.rev acc)
    | _ :: _ -> let field,tail = split 48 chars [] in loop tail (String.of_seq (List.to_seq field) :: acc) in
  loop (List.of_seq (String.to_seq text)) []
let render value = hex (reverse_fields (Bytes.to_string (Bls12_381.Fq12.to_bytes value)))
let render_gt value = hex (reverse_fields (Bytes.to_string (Bls12_381.GT.to_bytes value)))
let field text = let* value = raw text in
  Option.to_result ~none:"bad field" (Bls12_381.Fq12.of_bytes_opt (Bytes.of_string (reverse_fields (Bytes.to_string value))))
let run = function
  | ["field"; a; b] -> let* a = field a in let* b = field b in
      let* prime = unhex "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab" in
      let p = Z.of_bits (reverse prime) in
      Ok (String.concat "|" [render (Bls12_381.Fq12.mul a b);render (Bls12_381.Fq12.mul a a);
        Option.fold ~none:"none" ~some:render (Bls12_381.Fq12.inverse_opt a);
        render (Bls12_381.Fq12.pow a p);render (Bls12_381.Fq12.pow a (Z.mul p p));render (Bls12_381.Fq12.pow a (Z.pow p 3))])
  | ["final"; a] -> let* a = field a in
      Ok (Option.fold ~none:"none" ~some:render_gt (Bls12_381.Pairing.final_exponentiation_opt a))
  | ["pair"; p; q] -> let* p = raw p in let* q = raw q in
      let* p = Option.to_result ~none:"bad g1" (Bls12_381.G1.of_compressed_bytes_opt p) in
      let* q = Option.to_result ~none:"bad g2" (Bls12_381.G2.of_compressed_bytes_opt q) in
      Ok (render_gt (Bls12_381.Pairing.pairing p q))
  | [] | _ :: _ -> Error "bad operation"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
