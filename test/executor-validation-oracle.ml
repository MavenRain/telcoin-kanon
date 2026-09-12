open Oracle_bytes
let ( let* ) = Result.bind
module Address = Tn_types.Units.Address
let word raw = let* bytes = unhex raw in Option.to_result ~none:"word" (U256.of_be_bytes bytes)
let address raw = let* bytes = unhex raw in Option.to_result ~none:"address" (Address.of_bytes bytes)
let integer raw = Option.to_result ~none:"int" (int_of_string_opt raw)
let nonce raw = let* value = word raw in Option.to_result ~none:"nonce" (Option.bind (U256.to_int value) Nonce.of_int)
let spec = function "0" -> Spec.Shanghai | "1" -> Spec.Cancun | _ -> Spec.Prague
let word_hex value = hex (U256.to_be_bytes value)
let storage_text slots = String.concat "" (List.map (fun (key, value) -> word_hex key ^ "=" ^ word_hex value ^ ",") slots)
let world_text world = World_state.accounts world |> List.map (fun (address, account) ->
  String.concat ":" [hex (Address.to_bytes address); Nonce.to_string (Account.nonce account); word_hex (Account.balance account);
    hex (Account.code account); storage_text (Storage.bindings (Account.storage account))] ^ ";") |> String.concat ""
let parse_world raw =
  let entries = if String.equal raw "-" then [] else String.split_on_char ',' raw in
  List.fold_left (fun result entry ->
    let* world = result in
    match String.split_on_char ':' entry with
    | [addr; n; balance; code; slot] ->
        let* addr = address addr in let* nonce = nonce n in let* balance = word balance in
        let* code = unhex code in let* slot = word slot in
        let account = Account.make ~nonce ~balance |> fun a -> Account.with_code a code |> fun a -> Account.set_slot a U256.zero slot in
        Ok (World_state.set_account world addr account)
    | [] -> Error "empty account" | _ :: _ -> Error "account") (Ok World_state.empty) entries
let parse_block fields = match fields with
  | [fork; coinbase; basefee_address; chain; gas_limit; basefee] ->
      let* coinbase = address coinbase in let* basefee_address = address basefee_address in
      let* chain_id = word chain in let* gas_limit = word gas_limit in let* basefee = word basefee in
      Ok (Env.Block.make_at_spec ~spec:(spec fork) ~coinbase ~timestamp:U256.one ~number:U256.one ~prevrandao:U256.zero
        ~gas_limit ~basefee ~basefee_address ~chain_id ~blob_gasprice:U256.zero ~hashes:Block_hashes.empty)
  | [] -> Error "empty block" | _ :: _ -> Error "block"
let parse_rlp raw reader =
  let* bytes = unhex raw in let* item = Rlp.decode_exact bytes |> Result.map_error Rlp.error_to_string in
  reader item |> Result.map_error Tx_envelope.error_to_string
let parse_tx fields = match fields with
  | [mode; sender; n; gas; target; value; data; access; chain; maximum; priority; auths] ->
      let* sender = address sender in let* nonce = nonce n in let* gas_limit = integer gas in
      let* target_address = if String.equal target "" then Ok Address.zero else address target in
      let kind = if String.equal target "" then Transaction.Create else Transaction.Call target_address in
      let* value = word value in let* data = unhex data in let* access_list = parse_rlp access Tx_envelope.read_access_list in
      let* chain_id = if String.equal chain "" then Ok None else Result.map Option.some (word chain) in
      let* maximum = word maximum in let* priority = word priority in let* authorizations = parse_rlp auths Tx_envelope.read_authorization_list in
      let fee = match mode with
        | "0" -> Transaction.Legacy {gas_price=maximum}
        | "1" -> Transaction.Access_list {gas_price=maximum}
        | "2" -> Transaction.Dynamic {max_fee=maximum;max_priority=None}
        | "3" -> Transaction.Dynamic {max_fee=maximum;max_priority=Some priority}
        | _ -> Transaction.Set_code {max_fee=maximum;max_priority=priority;target=target_address;authorizations}
      in Ok (Transaction.make ~sender ~nonce ~gas_limit ~kind ~value ~data ~access_list ~chain_id ~fee)
  | [] -> Error "empty transaction" | _ :: _ -> Error "transaction"
let log_encoding log = Rlp.encode_list [Rlp.encode_bytes (Address.to_bytes (Log.address log));
  Rlp.encode_list (List.map (fun topic -> Rlp.encode_bytes (U256.to_be_bytes topic)) (Log.Topics.to_list (Log.topics log))); Rlp.encode_bytes (Log.data log)]
let receipt_details receipt =
  let output, created = match receipt with
    | Receipt.Success {output;created;_} -> output, Option.fold ~none:"" ~some:(fun a -> hex (Address.to_bytes a)) created
    | Receipt.Reverted {output;_} -> output, ""
    | Receipt.Halted _ -> "", ""
  in String.concat "|" [hex output;created;hex (Rlp.encode_list (List.map log_encoding (Receipt.logs receipt)))]
let dispatch line = match String.split_on_char ' ' line with
  | ["execute"; world_raw; block_raw; tx_raw] ->
      let* world = parse_world world_raw in let* block = parse_block (String.split_on_char ':' block_raw) in
      let* tx = parse_tx (String.split_on_char ':' tx_raw) in
      Executor.execute world ~block tx |> Result.map_error Executor.error_to_string |> Result.map (fun (receipt, world) ->
        Receipt.to_string receipt ^ "|" ^ world_text world ^ "|" ^ receipt_details receipt)
  | ["auth-hash"; chain; target; n] ->
      let* chain_id = word chain in let* address = address target in let* nonce = word n in
      let* auth = Option.to_result ~none:"authorization nonce" (Authorization.make ~chain_id ~address ~nonce) in
      Ok (hex (Authorization.signature_hash auth))
  | ["validate"; world_raw; block_raw; tx_raw] ->
      let* world = parse_world world_raw in let* block = parse_block (String.split_on_char ':' block_raw) in
      let* tx = parse_tx (String.split_on_char ':' tx_raw) in
      Executor.execute world ~block tx |> Result.map_error Executor.error_to_string |> Result.map (fun _ ->
        let kind = match Transaction.kind tx with Transaction.Call _ -> Intrinsic.Call | Transaction.Create -> Intrinsic.Create in
        let access_list = match Transaction.fee tx with Transaction.Legacy _ -> [] | Transaction.Access_list _ | Transaction.Dynamic _ | Transaction.Set_code _ -> Transaction.access_list tx in
        let initial = Intrinsic.initial_gas ~kind ~data:(Transaction.data tx) ~access_list ~authorizations:(Transaction.authorizations tx) in
        let floor = if Spec.is_enabled (Env.Block.spec block) ~from:Spec.Prague then Intrinsic.floor_gas ~data:(Transaction.data tx) else 0 in
        "ok:" ^ string_of_int initial ^ ":" ^ string_of_int floor)
  | ["finalize"; world_raw; mode; gas_limit; remaining; refund; auth_refund; floor_gas; effective; base_fee; sender; coinbase; basefee_address] ->
      let* world = parse_world world_raw in let* gas_limit = integer gas_limit in let* remaining = integer remaining in
      let* refund = integer refund in let* auth_refund = integer auth_refund in let* floor_gas = integer floor_gas in
      let* effective = word effective in let* base_fee = word base_fee in let* sender = address sender in
      let* coinbase = address coinbase in let* basefee_address = address basefee_address in
      let outcome = match mode with
        | "0" -> Executor.Ran_success {world;remaining;refund;logs=[];output="";created=None}
        | "1" -> Executor.Ran_revert {world;remaining;output=""}
        | _ -> Executor.Ran_halt {world;reason=Receipt.Frame_halt Interpreter.Out_of_gas}
      in
      let receipt, world = Executor.finalize ~gas_limit ~floor_gas ~effective ~base_fee ~sender ~coinbase ~basefee_address ~auth_refund outcome in
      Ok (Receipt.to_string receipt ^ "|" ^ world_text world)
  | ["hex"; raw] -> let* input = unhex raw in Ok (hex (System_contracts.bytes_of_hex input))
  | ["predeploy"; world] -> Result.map (fun world -> world_text (System_contracts.predeploy world)) (parse_world world)
  | ["warm"; fork] -> Ok (Executor.precompile_addresses (spec fork) |> List.map (fun a -> hex (Address.to_bytes a) ^ ";") |> String.concat "")
  | [] -> Error "empty request" | _ :: _ -> Error "request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
