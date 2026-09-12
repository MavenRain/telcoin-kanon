open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let rebuild_vote (v : Epoch_vote.t) = Epoch_vote.make ~epoch:v.epoch ~epoch_hash:v.epoch_hash ~public_key:v.public_key ~signature:v.signature
let rebuild_result (v : Consensus_result.t) = Consensus_result.make ~epoch:v.epoch ~round:v.round ~number:v.number ~hash:v.hash ~validator:v.validator ~signature:v.signature
let rebuild_epoch (v : Epoch_record.t) = Epoch_record.make ~epoch:v.epoch ~committee:v.committee ~next_committee:v.next_committee
  ~parent_hash:v.parent_hash ~final_state:v.final_state
  ~final_consensus:(Epoch_record.make_consensus_num_hash ~number:v.final_consensus.number ~hash:v.final_consensus.hash)
let rebuild_node (v : Node_record.t) =
  let rpc=Option.map (fun (v : Node_record.rpc_info) -> Node_record.make_rpc_info ~http:v.http ~ws:v.ws) v.info.rpc in
  Node_record.make ~info:(Node_record.make_network_info ~pubkey:v.info.pubkey ~multiaddrs:v.info.multiaddrs ~timestamp:v.info.timestamp ~rpc) ~signature:v.signature
let pair codec rebuild equal left right = Bcs.decode codec left |> Result.fold
  ~error:(fun error -> "error:" ^ Bcs.error_to_string error)
  ~ok:(fun decoded -> let a=rebuild decoded in
    let other=Bcs.decode codec right |> Result.fold ~error:(fun error -> "error:" ^ Bcs.error_to_string error)
      ~ok:(fun b -> string_of_bool (equal a b)) in
    hex (Bcs.encode codec a) ^ ":" ^ string_of_bool (equal a decoded) ^ ":" ^ other)
let compat raw = Node_record.decode_compat raw |> Result.fold
  ~error:(fun error -> "error:" ^ Node_record.error_to_string error)
  ~ok:(function
    | Node_record.Current record -> "current:" ^ hex (Bcs.encode Node_record.codec record)
    | Node_record.Legacy record -> "legacy:" ^ hex (Bcs.encode Node_record.codec record))
let run = function
  | [kind;left;right] -> let* left=raw left in let* right=raw right in
    Ok (match kind with
      | "0" -> pair Epoch_vote.codec rebuild_vote Epoch_vote.equal left right
      | "1" -> pair Consensus_result.codec rebuild_result Consensus_result.equal left right
      | "2" -> pair Epoch_record.codec rebuild_epoch Epoch_record.equal left right
      | "3" -> pair Node_record.codec rebuild_node Node_record.equal left right
      | "4" -> pair Node_record.legacy_codec rebuild_node Node_record.equal left right
      | "6" -> Bcs.decode Node_record.codec left |> Result.fold ~error:(fun error -> "error:" ^ Bcs.error_to_string error)
        ~ok:(fun record -> let legacy=Bcs.encode Node_record.legacy_codec record in hex legacy ^ ":" ^ compat legacy)
      | _ -> compat left)
  | [] | _::_ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
