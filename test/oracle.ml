(* Compiled only with copies of the pinned OCaml modules. *)
let ( let* ) = Result.bind
let parse parse_fn text = Option.to_result ~none:"bad number" (parse_fn text)
let hex text =
  String.to_seq text |> Seq.map (fun c -> Printf.sprintf "%02x" (Char.code c))
  |> List.of_seq |> String.concat ""
let byte_table = "\000\001\002\003\004\005\006\007\008\009\010\011\012\013\014\015\016\017\018\019\020\021\022\023\024\025\026\027\028\029\030\031\032\033\034\035\036\037\038\039\040\041\042\043\044\045\046\047\048\049\050\051\052\053\054\055\056\057\058\059\060\061\062\063\064\065\066\067\068\069\070\071\072\073\074\075\076\077\078\079\080\081\082\083\084\085\086\087\088\089\090\091\092\093\094\095\096\097\098\099\100\101\102\103\104\105\106\107\108\109\110\111\112\113\114\115\116\117\118\119\120\121\122\123\124\125\126\127\128\129\130\131\132\133\134\135\136\137\138\139\140\141\142\143\144\145\146\147\148\149\150\151\152\153\154\155\156\157\158\159\160\161\162\163\164\165\166\167\168\169\170\171\172\173\174\175\176\177\178\179\180\181\182\183\184\185\186\187\188\189\190\191\192\193\194\195\196\197\198\199\200\201\202\203\204\205\206\207\208\209\210\211\212\213\214\215\216\217\218\219\220\221\222\223\224\225\226\227\228\229\230\231\232\233\234\235\236\237\238\239\240\241\242\243\244\245\246\247\248\249\250\251\252\253\254\255" |> String.to_seq |> List.of_seq
let unhex text =
  let rec loop chars acc =
    match chars with
    | [] -> Ok (String.of_seq (List.to_seq (List.rev acc)))
    | [ _ ] -> Error "odd hex"
    | hi :: lo :: tail ->
        let code = "0x" ^ String.of_seq (List.to_seq [ hi; lo ]) in
        let* byte = parse int_of_string_opt code in
        let* char = Option.to_result ~none:"bad hex" (List.nth_opt byte_table byte) in
        loop tail (char :: acc)
  in
  loop (List.of_seq (String.to_seq text)) []
let decode codec render bytes =
  Bcs.decode codec bytes |> Result.map render |> Result.map_error Bcs.error_to_string
let prefix codec render bytes =
  Bcs.decode_prefix codec bytes
  |> Result.map (fun (value, offset) -> render value ^ ":" ^ string_of_int offset)
  |> Result.map_error Bcs.error_to_string
let int64_parse text =
  Option.fold ~none:(Int64.of_string_opt ("0u" ^ text)) ~some:Option.some (Int64.of_string_opt text)
let int64_text value = Printf.sprintf "%Lu" value
let option_text value = Option.fold ~none:"none" ~some:string_of_int value
type fixture_sum = Empty | Number of int | Blob of string
let fixture_sum_codec = Bcs.sum [
  Bcs.case ~index:0 Bcs.unit ~inject:(fun () -> Empty) ~project:(function Empty -> Some () | Number _ | Blob _ -> None);
  Bcs.case ~index:128 Bcs.u32 ~inject:(fun n -> Number n) ~project:(function Number n -> Some n | Empty | Blob _ -> None);
  Bcs.case ~index:2 Bcs.bytes ~inject:(fun bytes -> Blob bytes) ~project:(function Blob bytes -> Some bytes | Empty | Number _ -> None);
]
let decode_kind kind bytes =
  let canonical codec = decode codec (fun value -> hex (Bcs.encode codec value)) bytes in
  let refined = Bcs.refine ~inject:(fun n -> if n < 4 then Ok n else Error "too big") ~project:Fun.id Bcs.u8 in
  match kind with
  | "sum" -> canonical fixture_sum_codec
  | "sumoffset" -> canonical (Bcs.pair Bcs.u8 fixture_sum_codec)
  | "list8" -> canonical (Bcs.list Bcs.u8)
  | "list16" -> canonical (Bcs.list Bcs.u16)
  | "list64" -> canonical (Bcs.list Bcs.u64)
  | "listbytes" -> canonical (Bcs.list Bcs.bytes)
  | "map8" -> canonical (Bcs.sorted_map Bcs.u8 Bcs.u8 ~compare:Int.compare)
  | "map16" -> canonical (Bcs.sorted_map Bcs.u16 Bcs.u8 ~compare:(Bcs.encoded_compare Bcs.u16))
  | "mapbytes" -> canonical (Bcs.sorted_map Bcs.bytes Bcs.u8 ~compare:(Bcs.encoded_compare Bcs.bytes))
  | "set8" -> canonical (Bcs.btree_set Bcs.u8 ~compare:Int.compare)
  | "units" -> canonical (Bcs.list Bcs.unit)
  | "nested" -> canonical (Bcs.list (Bcs.list Bcs.u8))
  | "optionbytes" -> canonical (Bcs.option Bcs.bytes)
  | "triple" -> canonical (Bcs.triple Bcs.u32 Bcs.u32 Bcs.bytes)
  | "refine" -> canonical refined
  | "refineoffset" -> canonical (Bcs.pair Bcs.u16 refined)
  | "string" -> canonical Bcs.string_utf8
  | "u8" -> decode Bcs.u8 string_of_int bytes
  | "u16" -> decode Bcs.u16 string_of_int bytes
  | "u32" -> decode Bcs.u32 string_of_int bytes
  | "u64" -> decode Bcs.u64 int64_text bytes
  | "uleb" -> decode Bcs.uleb128 string_of_int bytes
  | "bool" -> decode Bcs.bool (fun value -> if value then "1" else "0") bytes
  | "bytes" -> decode Bcs.bytes hex bytes
  | "fixed3" -> decode (Bcs.fixed_bytes 3) hex bytes
  | "sized3" -> decode (Bcs.sized_bytes 3) hex bytes
  | "option" -> decode (Bcs.option Bcs.u8) option_text bytes
  | "prefix32" -> prefix Bcs.u32 string_of_int bytes
  | "prefixuleb" -> prefix Bcs.uleb128 string_of_int bytes
  | "offsetuleb" -> decode (Bcs.pair Bcs.u8 Bcs.uleb128) (fun (_, value) -> string_of_int value) bytes
  | _ -> Error "unknown decoder"
let encode_kind kind text =
  let integer codec = parse int_of_string_opt text |> Result.map (fun n -> hex (Bcs.encode codec n)) in
  match kind with
  | "u8" -> integer Bcs.u8
  | "u16" -> integer Bcs.u16
  | "u32" -> integer Bcs.u32
  | "u64" -> parse int64_parse text |> Result.map (fun n -> hex (Bcs.encode Bcs.u64 n))
  | "uleb" -> integer Bcs.uleb128
  | _ -> Error "unknown encoder"
let scalar kind text =
  let optional render value = Ok (Option.fold ~none:"none" ~some:render value) in
  let as_int make render =
    let* n = parse int_of_string_opt text in optional render (make n)
  in
  match kind with
  | "round" -> as_int Round.of_int Round.to_string
  | "epoch" -> as_int Units.Epoch.of_int Units.Epoch.to_string
  | "workerId" -> as_int Units.Worker_id.of_int (fun n -> string_of_int (Units.Worker_id.to_int n))
  | "stake" -> as_int Units.Stake.of_int Units.Stake.to_string
  | "duration" -> as_int Units.Duration.of_ms (fun n -> string_of_int (Units.Duration.to_ms n))
  | "timestamp" ->
      let* n = parse Int64.of_string_opt text in optional Units.Timestamp.to_string (Units.Timestamp.of_sec n)
  | "leaderRound" -> as_int (fun n -> Option.bind (Round.of_int n) Leader_round.of_round) (fun n -> Round.to_string (Leader_round.to_round n))
  | "roundNext" -> as_int Round.of_int (fun n -> Round.to_string (Round.succ n))
  | "roundPrev" -> as_int (fun n -> Option.bind (Round.of_int n) Round.pred) Round.to_string
  | "epochNext" -> as_int Units.Epoch.of_int (fun n -> Units.Epoch.to_string (Units.Epoch.succ n))
  | "leaderNext" -> as_int (fun n -> Option.map Leader_round.next (Option.bind (Round.of_int n) Leader_round.of_round)) (fun n -> Round.to_string (Leader_round.to_round n))
  | "leaderPrev" -> as_int (fun n -> Option.bind (Option.bind (Round.of_int n) Leader_round.of_round) Leader_round.prev) (fun n -> Round.to_string (Leader_round.to_round n))
  | "durationHalf" -> as_int Units.Duration.of_ms (fun n -> string_of_int (Units.Duration.to_ms (Units.Duration.half n)))
  | _ -> Error "unknown scalar"
let dispatch line =
  match String.split_on_char ' ' line with
  | [ "decode"; kind; text ] -> let* bytes = unhex text in decode_kind kind bytes
  | [ "encode"; kind; text ] -> encode_kind kind text
  | [ "scalar"; kind; text ] -> scalar kind text
  | _ -> Error "bad request"
let () =
  In_channel.input_lines stdin |> List.iter (fun line ->
    dispatch line |> Result.fold ~ok:(fun value -> "ok:" ^ value) ~error:(fun text -> "error: " ^ text)
    |> print_endline)
