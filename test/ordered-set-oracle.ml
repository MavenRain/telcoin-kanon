open Oracle_bytes
module type Key = sig
  type t
  val codec : t Bcs.t
  val compare : t -> t -> int
  module Set : Set.S with type elt = t
end
module Run (K : Key) = struct
  module S = K.Set
  let run left right key =
    let decode codec raw = let* raw = unhex raw in Bcs.decode codec raw |> Result.map_error Bcs.error_to_string in
    let* left = decode (Bcs.list K.codec) left in let* right = decode (Bcs.list K.codec) right in let* key = decode K.codec key in
    let left = S.of_list left and right = S.of_list right in
    let render set = hex (Bcs.encode (Bcs.list K.codec) (S.elements set)) in
    let optional = Option.fold ~none:"none" ~some:(fun key -> hex (Bcs.encode K.codec key)) in
    let below value = K.compare value key < 0 and at_least value = K.compare value key >= 0 and at_most value = K.compare value key <= 0 in
    let low, high = S.partition below left in let smaller, present, larger = S.split key left in
    Ok (String.concat "|" [render left; string_of_int (S.cardinal left); string_of_bool (S.is_empty left);
      render (S.add key left); render (S.remove key left); render (S.union left right); render (S.inter left right); render (S.diff left right);
      string_of_bool (S.subset left right); string_of_bool (S.disjoint left right); string_of_int (Int.compare (S.compare left right) 0);
      string_of_bool (S.equal left right); optional (S.min_elt_opt left); optional (S.max_elt_opt left); optional (S.choose_opt left);
      optional (S.find_opt key left); optional (S.find_first_opt at_least left); optional (S.find_last_opt at_most left);
      string_of_bool (S.for_all at_most left); string_of_bool (S.exists below left); render low; render high;
      render smaller; string_of_bool present; render larger; render (S.map (fun _ -> key) left);
      render (S.filter_map (fun value -> if below value then Some key else None) left);
      hex (Bcs.encode (Bcs.list K.codec) (List.of_seq (S.to_seq_from key left)))])
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
