open Oracle_bytes
module type Key = sig
  type t
  val codec : t Bcs.t
  val compare : t -> t -> int
  module Map : Map.S with type key = t
end
module Run (K : Key) = struct
  module M = K.Map
  let run left right key =
    let decode codec raw = let* raw = unhex raw in Bcs.decode codec raw |> Result.map_error Bcs.error_to_string in
    let pair = Bcs.pair K.codec Bcs.u32 in
    let* left = decode (Bcs.list pair) left in let* right = decode (Bcs.list pair) right in let* key = decode K.codec key in
    let left = M.of_list left and right = M.of_list right in
    let render_list values = hex (Bcs.encode (Bcs.list pair) values) in
    let render map = render_list (M.bindings map) in
    let optional = Option.fold ~none:"none" ~some:string_of_int in
    let binding = Option.fold ~none:"none" ~some:(fun entry -> hex (Bcs.encode pair entry)) in
    let below value = K.compare value key < 0 and at_least value = K.compare value key >= 0 and at_most value = K.compare value key <= 0 in
    let low, high = M.partition (fun key _ -> below key) left in let smaller, present, larger = M.split key left in
    let merge _ a b = match a,b with
      | None,None -> None | Some a,None -> Some (a+10) | None,Some b -> Some (b+20)
      | Some a,Some b -> if a=b then None else Some (a*100+b) in
    let lists = M.map (fun value -> [value]) left |> M.add_to_list key 7 |> M.add_to_list key 8 in
    Ok (String.concat "|" [render left; string_of_int (M.cardinal left); string_of_bool (M.is_empty left);
      render (M.add key 99 left); render (M.remove key left); optional (M.find_opt key left); string_of_bool (M.mem key left);
      string_of_int (Int.compare (M.compare Int.compare left right) 0); string_of_bool (M.equal Int.equal left right);
      binding (M.min_binding_opt left); binding (M.max_binding_opt left); binding (M.choose_opt left);
      binding (M.find_first_opt at_least left); binding (M.find_last_opt at_most left); render low; render high;
      render smaller; optional present; render larger;
      render (M.update key (fun value -> Some (Option.fold ~none:100 ~some:succ value)) left);
      render (M.update key (fun _ -> None) left); render (M.map succ left); render (M.mapi (fun key value -> value+(if below key then 1 else 2)) left);
      render (M.filter_map (fun _ value -> if value mod 2=0 then Some (value+3) else None) left); render (M.merge merge left right);
      render (M.union (fun _ a b -> if a=b then None else Some (a+2*b)) left right); render_list (List.of_seq (M.to_seq_from key left));
      string_of_bool (M.for_all (fun key _ -> at_most key) left); string_of_bool (M.exists (fun key _ -> below key) left);
      render (M.add_seq (M.to_seq right) left); hex (Bcs.encode (Bcs.list (Bcs.pair K.codec (Bcs.list Bcs.u32))) (M.bindings lists))])
end
module Round_key = struct
  include Round
  let codec = Bcs.refine Bcs.u32 ~inject:(fun n -> Option.to_result ~none:"round" (of_int n)) ~project:to_int
end
module Authority_key = struct
  include Authority_id
  let codec = Bcs.refine (Bcs.fixed_bytes 32) ~inject:(fun raw -> Option.to_result ~none:"authority" (of_bytes raw)) ~project:to_bytes
end
module R = Run (Round_key)
module A = Run (Authority_key)
let run = function
  | ["round"; left; right; key] -> R.run left right key
  | ["authority"; left; right; key] -> A.run left right key
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
