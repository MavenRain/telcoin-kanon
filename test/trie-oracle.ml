open Oracle_bytes
let ( let* ) = Result.bind
let integer raw = Option.to_result ~none:"bad int" (int_of_string_opt raw)
let fixture codec raw = let* bytes = unhex raw in Bcs.decode codec bytes |> Result.map_error Bcs.error_to_string
let rec integers = function
  | [] -> Ok []
  | head :: tail -> let* value = integer head in let* rest = integers tail in Ok (value :: rest)
let dispatch line = match String.split_on_char ' ' line with
  | ["nibbles"; a; b; start; length] -> let* a = unhex a in let* b = unhex b in let* start = integer start in let* length = integer length in
    let a = Nibbles.unpack a in let b = Nibbles.unpack b in
    Ok (String.concat ":" [Nibbles.to_hex a; hex (Nibbles.pack a); Option.fold ~none:"none" ~some:string_of_int (Nibbles.nth_opt a start);
      Nibbles.to_hex (Nibbles.sub a ~pos:start ~len:length); Nibbles.to_hex (Nibbles.drop a start); string_of_int (Nibbles.common_prefix_len a b ~from:start);
      string_of_int (Int.compare (Nibbles.compare a b) 0)])
  | ["mask"; raw] -> let* values = fixture (Bcs.list Bcs.bytes) raw in let* values = integers values in let path = Nibbles.of_int_list values in
    Ok (String.concat ":" [Nibbles.to_hex path; hex (Nibbles.pack path); hex (Hex_prefix.encode path ~is_leaf:true); hex (Hex_prefix.encode path ~is_leaf:false)])
  | ["prefix"; raw] -> let* bytes = unhex raw in Ok (Hex_prefix.decode bytes |> Result.fold ~error:Hex_prefix.error_to_string ~ok:(fun (path, is_leaf) ->
    String.concat ":" [Nibbles.to_hex path; string_of_bool is_leaf; hex (Hex_prefix.encode path ~is_leaf)]))
  | ["node"; path; value] -> let* path = unhex path in let* value = unhex value in
    let path = Nibbles.unpack path in let leaf = Node.Leaf { path; value } in
    let extension = Node.Extension { path; child = Node.to_ref leaf } in
    let branch = Node.Branch { children = [| Some (Node.to_ref leaf); None |]; value = Some value } in
    Ok (String.concat ":" [hex (Node.encode leaf); hex (Node.to_ref leaf); hex (Node.encode extension); hex (Node.encode branch)])
  | ["child_options"; mode] ->
    let children = if mode = "0" then [] else if mode = "1" then [None] else [Some Node.absent] in
    Ok (List.nth_opt children 0 |> Option.fold ~none:"empty" ~some:(Option.fold ~none:"absent" ~some:(fun bytes -> "present:" ^ hex bytes)))
  | ["root"; raw; secure] -> let* entries = fixture (Bcs.list (Bcs.pair Bcs.bytes Bcs.bytes)) raw in
    Ok ((if secure = "1" then Trie.secure_root_of entries else Trie.root entries) |> Result.fold ~error:Trie.error_to_string ~ok:hex)
  | ["ordered"; raw] -> let* items = fixture (Bcs.list Bcs.bytes) raw in
    Ok (String.concat ":" [hex (Trie.ordered_trie_root items); hex (Trie.ordered_trie_root_rlp items)])
  | ["account"; nonce; balance; storage_root; code_hash] -> let* nonce = integer nonce in
    let* balance = Option.to_result ~none:"bad word" (U256.of_hex balance) in let* storage_root = unhex storage_root in let* code_hash = unhex code_hash in
    Ok (hex (Trie.account_rlp ~nonce ~balance ~storage_root ~code_hash))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
