open Oracle_bytes
let ( let* ) = Result.bind
let decode codec raw = let* bytes=unhex raw in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let native raw = int_of_string_opt raw |> Option.to_result ~none:"bad integer"
module Mock_decoder = struct
  type tx = { hash : Tn_keccak.t; blob : bool; gas : int64 }
  let decode_and_recover bytes =
    if String.length bytes < 9 then Error "fixture short"
    else
      let prefix = String.to_seq bytes |> Seq.take 9 |> String.of_seq in
      let* kind, gas = Bcs.decode (Bcs.pair Bcs.u8 Bcs.u64) prefix |> Result.map_error Bcs.error_to_string in
      if kind = 2 then Error "fixture rejection"
      else Ok {hash=Tn_keccak.digest bytes;blob=kind=1;gas}
  let hash tx = tx.hash
  let is_eip4844 tx = tx.blob
  let gas_limit tx = tx.gas
end
module Mock = Batch_validator.Make(Mock_decoder)
let penalty error = match Batch_validator.penalty error with
  | Batch_validator.Mild -> "mild"
  | Batch_validator.Medium -> "medium"
  | Batch_validator.Severe -> "severe"
  | Batch_validator.Fatal -> "fatal"
let failure error = "error:" ^ penalty error ^ ":" ^ Batch_validator.error_to_string error
let dispatch line = match String.split_on_char ' ' line with
  | [("mock" | "real" as mode); raw; worker; epoch; fee] ->
      let* sealed = decode Batch.Sealed.codec raw in
      let* worker = native worker in
      let* worker_id = Units.Worker_id.of_int worker |> Option.to_result ~none:"bad worker" in
      let* epoch = native epoch in
      let* epoch = Units.Epoch.of_int epoch |> Option.to_result ~none:"bad epoch" in
      let* fee = decode Bcs.u64 fee in
      let base_fee_per_gas = Units.Base_fee.of_int64 fee in
      if String.equal mode "mock" then
        Ok (Mock.validate (Mock.make ~worker_id ~epoch ~base_fee_per_gas) sealed
          |> Result.fold ~error:failure ~ok:(fun valid ->
            "ok:" ^ Digests.Batch_digest.to_hex (Mock.Valid.digest valid) ^ ":" ^ hex (Batch.preimage (Mock.Valid.batch valid))))
      else
        Ok (Batch_validator.Validator.validate (Batch_validator.Validator.make ~worker_id ~epoch ~base_fee_per_gas) sealed
          |> Result.fold ~error:failure ~ok:(fun valid ->
            "ok:" ^ Digests.Batch_digest.to_hex (Batch_validator.Validator.Valid.digest valid) ^ ":" ^ hex (Batch.preimage (Batch_validator.Validator.Valid.batch valid))))
  | ["size"; lengths] ->
      let* lengths = List.fold_right (fun raw acc ->
        let* values=acc in let* n=native raw in if n<0 then Error "bad size" else Ok (n::values))
        (String.split_on_char ',' lengths) (Ok []) in
      let batch = Batch.make ~transactions:(List.map (fun n -> String.make n 'a') lengths)
        ~epoch:Units.Epoch.zero ~beneficiary:Units.Address.zero ~base_fee_per_gas:(Units.Base_fee.of_int64 0L) ~worker_id:Units.Worker_id.zero in
      Ok (Mock.validate_batch_size_bytes batch |> Result.fold ~ok:(fun () -> "ok") ~error:failure)
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "fixture:" ^ text) |> print_endline)
