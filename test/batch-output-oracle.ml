open Oracle_bytes
let ( let* ) = Result.bind
let decode codec raw = let* bytes=unhex raw in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let nonce n = Printf.sprintf "%Lu" (Units.Sequence_number.to_int64 n)
let timestamp n = Int64.to_string (Units.Timestamp.to_sec n)
let address a = hex (Units.Address.to_bytes a)
let describe output =
  let pairs = Output.certified output |> List.concat_map (fun (a,batches)->List.map (fun b->(a,b)) batches) in
  let rec zip digests pairs = match digests,pairs with
    | d::ds,(a,b)::bs -> (Digests.Batch_digest.to_hex d ^ ":" ^ address a ^ ":" ^ hex (Batch.preimage b) ^ ";") ^ zip ds bs
    | [],[] | [],_::_ | _::_,[] -> "" in
  String.concat "|" [Digests.Output_digest.to_hex (Output.output_digest output);address (Output.leader_address output);
    Units.Epoch.to_string (Output.leader_epoch output);timestamp (Output.committed_at output);nonce (Output.nonce output);
    zip (Output.batch_digests output) pairs]
let spec_text spec = String.concat ":" [Digests.Batch_digest.to_hex (Block_plan.Spec.batch_digest spec);
  address (Block_plan.Spec.beneficiary spec);Printf.sprintf "%Lu" (Block_plan.Spec.gas_limit spec);
  Units.Base_fee.to_string (Block_plan.Spec.base_fee spec);hex (Block_plan.Spec.mix_hash spec);
  hex (U256.to_be_bytes (Batch_position.word (Block_plan.Spec.position spec)));nonce (Block_plan.Spec.nonce spec);
  Digests.Output_digest.to_hex (Block_plan.Spec.consensus_root spec);timestamp (Block_plan.Spec.timestamp spec);
  if Block_plan.Spec.closes_epoch spec then "1" else "0"]
let plan_text = function
  | Block_plan.Skip -> "skip"
  | Block_plan.Close_block spec -> "close:" ^ String.concat ":" [address (Block_plan.Close_spec.beneficiary spec);
      hex (Block_plan.Close_spec.mix_hash spec);Digests.Output_digest.to_hex (Block_plan.Close_spec.consensus_root spec);
      nonce (Block_plan.Close_spec.nonce spec);timestamp (Block_plan.Close_spec.timestamp spec)]
  | Block_plan.Batch_blocks specs -> "batches:" ^ String.concat "" (List.map (fun s->spec_text s ^ ";") (Nonempty.to_list specs))
let dispatch line = match String.split_on_char ' ' line with
  | [("attach" | "plan" as op);raw;bodies;missing;closing] ->
      let* consensus=decode Consensus_block.codec raw in
      let* bodies=decode (Bcs.list Batch.codec) bodies in
      let lookup digest=List.find_opt (fun batch->Digests.Batch_digest.equal digest (Batch.digest batch)) bodies in
      let address_of id = if String.equal missing (Authority_id.to_hex id) then None else
        Option.bind (unhex (Authority_id.to_hex id) |> Result.to_option) (fun bytes->
          Units.Address.of_bytes (String.to_seq bytes |> Seq.take 20 |> String.of_seq)) in
      let* output=Output.attach ~consensus ~lookup ~address_of |> Result.map_error Output.error_to_string in
      if String.equal op "attach" then Ok (describe output)
      else Block_plan.plan output ~closes_epoch:(String.equal closing "1") |> Result.map plan_text |> Result.map_error Block_plan.error_to_string
  | ["payload";raw] ->
      let* batch=decode Batch.codec raw in
      Ok ("payload:" ^ String.concat "" (List.map (fun tx->hex (Tx_envelope.encode_2718 tx) ^ ";") (Batch_payload.executable_txs batch)))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text->"error:" ^ text) |> print_endline)
