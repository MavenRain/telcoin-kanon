open Oracle_bytes
module type Group = sig
  type t
  val of_compressed_bytes_opt : bytes -> t option
  val to_compressed_bytes : t -> bytes
  val negate : t -> t
  val add : t -> t -> t
  val mul : t -> Bls12_381.Fr.t -> t
end
module Test (G : Group) = struct
  let render point = hex (Bytes.to_string (G.to_compressed_bytes point))
  let decode text = let* raw = unhex (if String.equal text "-" then "" else text) in
    Ok (G.of_compressed_bytes_opt (Bytes.of_string raw))
  let run = function
    | ["decode"; raw] -> let* point = decode raw in Ok (Option.fold ~none:"none" ~some:render point)
    | ["ops"; left; right; scalar] -> let* left = decode left in let* right = decode right in
        let* scalar = unhex scalar in
        let value = Z.of_bits (String.of_seq (List.to_seq (List.rev (List.of_seq (String.to_seq scalar))))) in
        (match left,right with
        | Some left,Some right -> Ok (String.concat "|" [render left;render (G.negate left);
            render (G.add left left);render (G.add left right);render (G.mul left (Bls12_381.Fr.of_z value))])
        | None,_ | _,None -> Ok "none")
    | [] | _ :: _ -> Error "bad operation"
end
module G1 = Test (Bls12_381.G1)
module G2 = Test (Bls12_381.G2)
let run = function
  | "g1" :: args -> G1.run args
  | "g2" :: args -> G2.run args
  | [] | _ :: _ -> Error "bad group"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
