open Oracle_bytes
let ( let* ) = Result.bind
let csv raw = if String.equal raw "-" then [] else String.split_on_char ',' raw
let rec traverse f = function [] -> Ok [] | x::xs -> let* y=f x in let* ys=traverse f xs in Ok (y::ys)
let decode codec raw = let* bytes=unhex raw in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let key raw = let* n=seed raw in Ok (Tn_crypto.Secret_key.public_key (Tn_crypto.Secret_key.derive n))
let leader raw = let* public=key raw in Ok (Authority_id.of_public_key public)
let make_committee raw shared =
  let* keys=traverse key (csv raw) in
  let* authorities=keys |> List.mapi (fun i protocol_key ->
    let* bytes=unhex (Printf.sprintf "%040x" (if shared then 9 else i+1)) in
    let* execution_address=Units.Address.of_bytes bytes |> Option.to_result ~none:"bad address" in
    Ok (Authority.make ~protocol_key ~execution_address)) |> traverse Fun.id in
  Committee.create ~epoch:Units.Epoch.zero authorities |> Result.map_error Committee.error_to_string
let describe output =
  let pairs=Output.certified output |> List.concat_map (fun (a,batches)->List.map (fun b->a,b) batches) in
  let rec zip digests pairs=match digests,pairs with
    | d::ds,(a,b)::bs -> Digests.Batch_digest.to_hex d ^ ":" ^ hex (Units.Address.to_bytes a) ^ ":" ^ hex (Batch.preimage b) ^ ";" ^ zip ds bs
    | [],[] | [],_::_ | _::_,[] -> "" in
  String.concat "|" [Digests.Output_digest.to_hex (Output.output_digest output);
    hex (Units.Address.to_bytes (Output.leader_address output));Units.Epoch.to_string (Output.leader_epoch output);
    Units.Timestamp.to_string (Output.committed_at output);Printf.sprintf "%Lu" (Units.Sequence_number.to_int64 (Output.nonce output));
    zip (Output.batch_digests output) pairs]
let dispatch line = match String.split_on_char ' ' line with
  | ["books";older;newer;queries] ->
    let* older=make_committee older false in let* newer=make_committee newer true in
    let book=Address_book.union (Address_book.of_committee newer) (Address_book.of_committee older) in
    let* queries=traverse leader (csv queries) in
    Ok (List.map (fun id->Option.fold ~none:"none" ~some:(fun a->hex (Units.Address.to_bytes a)) (Address_book.find book id) ^ ";") queries |> String.concat "")
  | ["store";raw;queries] ->
    let* bodies=decode (Bcs.list Batch.codec) raw in
    let store=Batch_store.of_bodies bodies in
    let* queries=traverse (fun raw->let* bytes=unhex raw in
      let* digest=Tn_crypto.Digest.of_bytes bytes |> Option.to_result ~none:"bad digest" in
      Ok (Digests.Batch_digest.of_digest digest)) (csv queries) in
    Ok (string_of_int (Batch_store.cardinal store) ^ "|" ^
      (List.map (fun digest->Option.fold ~none:"none" ~some:(fun b->hex (Batch.preimage b)) (Batch_store.find store digest) ^ ";") queries |> String.concat ""))
  | ["receive";members;raw;bodies] ->
    let* committee=make_committee members false in let book=Address_book.of_committee committee in
    let* sub_dag=decode Sub_dag.codec raw in let* bodies=decode (Bcs.list Batch.codec) bodies in
    let subscriber=Subscriber.create Consensus_chain.genesis in
    let* next,consensus,output=Subscriber.receive subscriber sub_dag ~bodies:(Batch_store.of_bodies bodies)
      ~address_of:(Address_book.find book) |> Result.map_error Subscriber.error_to_string in
    Ok (String.concat "|" [Consensus_block.Number.to_string (Subscriber.number subscriber);
      Consensus_block.Number.to_string (Subscriber.number next);
      Digests.Output_digest.to_hex (Consensus_block.digest (Subscriber.mint subscriber sub_dag));
      Digests.Output_digest.to_hex (Consensus_block.digest consensus);describe output])
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text->"error:" ^ text) |> print_endline)
