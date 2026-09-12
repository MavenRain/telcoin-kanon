open Oracle_bytes
let run = function
  | [mode;limit;value] ->
    let* max_message_size=int_of_string_opt limit |> Option.to_result ~none:"bad limit" in
    let* raw=unhex (if String.equal value "-" then "" else value) in
    let frame_error e="error:" ^ Wire_frame.error_to_string e in
    let message_error e="error:" ^ Wire_frame.error_or_bcs_to_string e in
    let decoded (bytes,n)=hex bytes ^ ":" ^ string_of_int n in
    Ok (match mode with
      | "0" -> string_of_int (Wire_frame.max_compress_len max_message_size)
      | "1" -> Wire_frame.parse_header ~max_message_size raw |> Result.fold ~error:frame_error
        ~ok:(fun (h : Wire_frame.header) -> string_of_int h.uncompressed_len ^ ":" ^ string_of_int h.compressed_len)
      | "2" -> Wire_frame.encode ~max_message_size raw |> Result.fold ~error:frame_error ~ok:hex
      | "3" -> Wire_frame.decode ~max_message_size raw |> Result.fold ~error:frame_error ~ok:decoded
      | "4" -> Wire_frame.encode_msg ~max_message_size Bcs.bytes raw |> Result.fold ~error:message_error ~ok:hex
      | _ -> Wire_frame.decode_msg ~max_message_size Bcs.bytes raw |> Result.fold ~error:message_error ~ok:decoded)
  | [] | _::_ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
