open Oracle_bytes
let raw s=unhex (if s="-" then "" else s)
let integer s=int_of_string_opt s |> Option.to_result ~none:"integer"
let integers s=if s="empty" then Ok [] else
  List.fold_left (fun acc text -> let* acc=acc in let* value=integer text in Ok (value::acc)) (Ok []) (String.split_on_char ',' s) |> Result.map List.rev
let pair codec equal left right=Bcs.decode codec left |> Result.fold ~error:(fun e -> "error:" ^ Bcs.error_to_string e)
  ~ok:(fun value -> let other=Bcs.decode codec right |> Result.fold ~error:(fun e -> "error:" ^ Bcs.error_to_string e) ~ok:(fun v -> string_of_bool (equal value v)) in
    hex (Bcs.encode codec value) ^ ":true:" ^ other)
let unit_frames=Bcs.list (Sync_frame.codec Bcs.unit)
let pack_text frames=Digestif.BLAKE2S.(to_hex (digest_string (Bcs.encode unit_frames frames))) ^ "|"
  ^ String.concat "" (List.map (fun frame -> Sync_frame.to_string (fun () -> "unit") frame ^ ";") frames)
let groups_text groups="groups:" ^ String.concat "" (List.map (fun group -> "[" ^ String.concat "" (List.map (fun n -> string_of_int n ^ ",") group) ^ "]") groups)
let reader_text codec=Result.fold ~error:(fun e -> "error:" ^ Sync_reader.violation_to_string e)
  ~ok:(fun (output,done_) -> hex (Bcs.encode codec output) ^ "|" ^ string_of_bool done_)
let run=function
  | ["record";kind;left;right] -> let* left=raw left in let* right=raw right in Ok (match kind with
    | "0" -> pair Sync_request.worker_codec Sync_request.worker_equal left right
    | "1" -> pair Sync_request.primary_codec Sync_request.primary_equal left right
    | "2" -> pair (Sync_frame.codec Sync_request.worker_codec) (Sync_frame.equal Sync_request.worker_equal) left right
    | _ -> pair (Sync_frame.codec Sync_request.primary_codec) (Sync_frame.equal Sync_request.primary_equal) left right)
  | ["frame";wire] -> let* wire=raw wire in Ok (Bcs.decode (Sync_frame.codec Bcs.unit) wire |> Result.fold
    ~error:(fun e -> "error:" ^ Bcs.error_to_string e)
    ~ok:(fun frame -> Sync_frame.to_string (fun () -> "unit") frame ^ "|" ^ (Sync_reader.opening frame |> Result.fold
      ~error:Sync_reader.violation_to_string ~ok:(function
      | Sync_reader.Proceed -> "proceed"
      | Sync_reader.Denied Sync_frame.At_capacity -> "denied:0"
      | Sync_reader.Denied Sync_frame.Unavailable -> "denied:1"
      | Sync_reader.Peer_error e -> "peer:" ^ Sync_reader.frame_error_name e))))
  | ["pack";mode;size;payload] -> let* size=integer size in let* payload=raw payload in Ok (match mode with
    | "1" -> pack_text (Sync_chunking.pack_frames payload)
    | _ -> Sync_chunking.pack_frames_with ~chunk_size:size payload |> Result.fold ~error:(fun e -> "error:" ^ Sync_chunking.error_to_string e) ~ok:pack_text)
  | ["groups";mode;items;target;cap] -> let* items=integers items in let* target_size=integer target in let* response_cap=integer cap in Ok (match mode with
    | "0" -> groups_text (Sync_chunking.cert_batches_bounded ~encoded_size:Fun.id ~target_size ~response_cap items)
    | "1" -> groups_text (Sync_chunking.cert_batches ~encoded_size:Fun.id items)
    | "2" -> groups_text (Sync_chunking.digest_chunks items)
    | _ -> string_of_int (Sync_chunking.max_sync_frame_size ~max_batch_size:response_cap))
  | ["reader";mode;frames;cap;requested] -> let* frames=raw frames in let* cap=integer cap in let* requested=raw requested in
    let* frames=Bcs.decode unit_frames frames |> Result.map_error Bcs.error_to_string in
    (match mode with
    | "0" -> Ok (reader_text Bcs.bytes (Sync_reader.Pack_reader.run frames))
    | "1" -> Ok (reader_text Sync_reader.Cert_reader.batch_codec (Sync_reader.Cert_reader.run ~accept_cap:cap frames))
    | _ -> let* batches=Bcs.decode (Bcs.list Batch.codec) requested |> Result.map_error Bcs.error_to_string in
      Ok (reader_text (Bcs.list Batch.codec) (Sync_reader.Batch_reader.run ~requested:(List.map Batch.digest batches) frames)))
  | [] | _::_ -> Error "request"
let ()=In_channel.input_lines stdin |> List.iter (fun line -> print_endline
  (Result.fold ~ok:Fun.id ~error:(fun e -> "setup:" ^ e) (run (String.split_on_char ' ' line))))
