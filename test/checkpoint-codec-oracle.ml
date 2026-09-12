open Oracle_bytes
module C = Checkpoint_codec
let roundtrip codec raw = Bcs.decode codec raw |> Result.map (fun value -> hex (Bcs.encode codec value))
  |> Result.map_error Bcs.error_to_string
let run = function
  | ["codec";kind;raw] ->
      let* raw=unhex (if String.equal raw "-" then "" else raw) in
      (match kind with
      | "0" -> roundtrip (C.nat "count") raw | "1" -> roundtrip C.u256 raw
      | "2" -> roundtrip C.keccak raw | "3" -> roundtrip C.hash32 raw
      | "4" -> roundtrip C.address raw | "5" -> roundtrip C.digest_raw raw
      | "6" -> roundtrip C.batch_digest raw | "7" -> roundtrip C.output_digest raw
      | "8" -> roundtrip C.epoch raw | "9" -> roundtrip C.round raw
      | "10" -> roundtrip C.timestamp raw | "11" -> roundtrip C.sequence_number raw
      | "12" -> roundtrip C.nonce raw | "13" -> roundtrip C.bloom raw
      | "14" -> roundtrip C.position raw | "15" -> roundtrip C.withdrawal raw
      | "16" -> roundtrip C.public_key raw | "17" -> roundtrip C.authority_id raw
      | "18" -> roundtrip C.authority raw | "19" -> roundtrip C.storage raw
      | "20" -> roundtrip C.account raw | "21" -> roundtrip C.world_state raw
      | "22" -> roundtrip C.block_header raw | "23" -> roundtrip C.anchor raw
      | "24" -> roundtrip C.recent_hashes raw | "25" -> roundtrip C.committee raw
      | "26" -> roundtrip C.rewards_counter raw | "27" -> roundtrip C.phase raw
      | "28" -> roundtrip C.engine_persisted raw | "29" -> roundtrip C.checkpoint raw
      | _ -> Error "bad kind")
  | ["record";kind;raw] ->
      let* raw=unhex (if String.equal raw "-" then "" else raw) in
      (match kind with
      | "0" -> Record_codec.decode_record raw |> Result.map (fun value -> hex (Record_codec.encode_record value))
          |> Result.map_error Record_codec.error_to_string
      | _ -> Record_codec.Meta.decode raw |> Result.map (fun value -> hex (Record_codec.Meta.encode value))
          |> Result.map_error Record_codec.error_to_string)
  | ["block";raw] ->
      let* raw=unhex raw in let* dag=Bcs.decode Sub_dag.codec raw |> Result.map_error Bcs.error_to_string in
      let _,block=Consensus_chain.append Consensus_chain.genesis dag in
      Ok (hex (Bcs.encode Consensus_block.codec block))
  | [] | _::_ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
