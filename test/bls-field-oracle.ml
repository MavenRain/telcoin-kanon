open Oracle_bytes
let number raw = let* raw = unhex (if String.equal raw "-" then "" else raw) in
  Ok (Z.of_bits (String.of_seq (List.to_seq (List.rev (List.of_seq (String.to_seq raw))))))
let prime = number "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"
let render = Z.format "%096x"
let run command =
  let* p = prime in let reduce value = Z.erem (Z.add (Z.erem value p) p) p in
  let add a b = reduce (Z.add a b) and sub a b = reduce (Z.sub a b) and mul a b = reduce (Z.mul a b) in
  let inverse value = if Z.equal value Z.zero then None else Some (Z.invert value p) in
  let sqrt_exists value = Z.equal value Z.zero || Z.equal (Z.powm value (Z.div (Z.pred p) (Z.of_int 2)) p) Z.one in
  let plus (a,b) (c,d) = add a c,add b d and minus (a,b) (c,d) = sub a c,sub b d in
  let times (a,b) (c,d) = sub (mul a c) (mul b d),add (mul a d) (mul b c) in
  let render2 (a,b) = render a ^ render b in
  let rec power2 acc base exponent = if Z.equal exponent Z.zero then acc else
    power2 (if Z.testbit exponent 0 then times acc base else acc) (times base base) (Z.shift_right exponent 1) in
  match command with
  | ["decode"; raw] -> let* value = number raw in Ok (if String.length raw=96 && Z.lt value p then render value else "none")
  | ["base"; a; b] -> let* a = number a in let* b = number b in let a=reduce a and b=reduce b in
      Ok (String.concat "|" [render a;render b;render (add a b);render (sub a b);render (mul a b);render (sub Z.zero a);
        Option.fold ~none:"none" ~some:render (inverse a);if sqrt_exists a then "some" else "none"])
  | ["extension"; a; b] ->
      let pair raw =
        let chars=List.of_seq (String.to_seq raw) in let left,right=List.mapi (fun i c -> i,c) chars |> List.partition (fun (i,_) -> i<96) in
        let text values=String.of_seq (List.to_seq (List.map snd values)) in
        let* a=number (text left) in let* b=number (text right) in Ok (reduce a,reduce b) in
      let* a=pair a in let* b=pair b in let x,y=a in
      let inv=Option.map (fun n -> mul x n,sub Z.zero (mul y n)) (inverse (add (mul x x) (mul y y))) in
      let square = a=(Z.zero,Z.zero) || power2 (Z.one,Z.zero) a (Z.div (Z.pred (Z.mul p p)) (Z.of_int 2))=(Z.one,Z.zero) in
      Ok (String.concat "|" [render2 (plus a b);render2 (minus a b);render2 (times a b);render2 (times a a);
        Option.fold ~none:"none" ~some:render2 inv;render2 (times a (Z.one,Z.one));if square then "some" else "none"])
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
