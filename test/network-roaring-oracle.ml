open Oracle_bytes
let integer text = int_of_string_opt text |> Option.to_result ~none:"bad integer"
let rec traverse f = function [] -> Ok [] | x::xs -> let* v=f x in let* vs=traverse f xs in Ok (v::vs)
let raw text = unhex (if String.equal text "-" then "" else text)
let render bitmap member =
  let values=Roaring.to_list bitmap in
  let recreated=Roaring.of_list values |> Result.fold ~error:(fun error -> "error:" ^ Roaring.error_to_string error)
    ~ok:(fun other -> string_of_bool (Roaring.equal bitmap other)) in
  String.concat "|" [hex (Roaring.to_bytes bitmap);string_of_int (Roaring.cardinality bitmap);
    Digestif.BLAKE2S.(to_hex (digest_string (Bcs.encode (Bcs.list Bcs.u32) values)));
    string_of_bool (Roaring.mem member bitmap);recreated]
let run = function
  | ["list";values;member] ->
    let* member=integer member in
    let* values=traverse integer (if String.equal values "empty" then [] else String.split_on_char ',' values) in
    Ok (Roaring.of_list values |> Result.fold ~error:(fun error -> "error:" ^ Roaring.error_to_string error) ~ok:(fun value -> render value member))
  | ["raw";value;member] -> let* member=integer member in let* value=raw value in
    Ok (Roaring.of_bytes value |> Result.fold ~error:(fun error -> "error:" ^ Roaring.error_to_string error) ~ok:(fun bitmap -> render bitmap member))
  | ["codec";value;member] -> let* member=integer member in let* value=raw value in
    Ok (Bcs.decode Roaring.codec value |> Result.fold ~error:(fun error -> "error:" ^ Bcs.error_to_string error) ~ok:(fun bitmap -> render bitmap member))
  | ["error";kind;a;b] -> let* a=integer a in let* b=integer b in
    Ok (Roaring.error_to_string (match kind with
      | "0" -> Roaring.Unknown_cookie {cookie=a}
      | "1" -> Roaring.Too_many_containers {count=a}
      | "2" -> Roaring.Truncated {offset=a}
      | "3" -> Roaring.Trailing_bytes {consumed=a;total=b}
      | "4" -> Roaring.Value_out_of_range {value=a}
      | _ -> Roaring.Run_out_of_range {start=a;len=b}))
  | [] | _::_ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "setup:" ^ error) (run (String.split_on_char ' ' line))))
