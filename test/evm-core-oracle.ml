open Oracle_bytes
module Evm_stack = Stack
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let option_int = Option.fold ~none:"none" ~some:string_of_int
let join = String.concat ":"
let stack_text stack = string_of_int (Evm_stack.depth stack) ^ ":" ^ (Evm_stack.to_list stack |> List.map (fun w -> option_int (U256.to_int w) ^ ",") |> String.concat "")
let stack_result = Result.fold ~error:Evm_stack.error_to_string ~ok:stack_text
let parse_address text = let* raw = unhex text in Option.to_result ~none:"bad address" (Units.Address.of_bytes raw)
let dispatch line = match String.split_on_char ' ' line with
  | ["stack"; count; op; depth] -> let* count = integer count in let* depth = integer depth in
    Ok (Evm_stack.of_list (List.init count (fun i -> Option.value ~default:U256.zero (U256.of_int (count - i - 1))))
      |> Option.fold ~none:"none" ~some:(fun stack -> match op with
        | "0" -> stack_text stack
        | "1" -> stack_result (Evm_stack.push (U256.of_int 65535 |> Option.value ~default:U256.zero) stack)
        | "2" -> Evm_stack.pop stack |> Result.fold ~error:Evm_stack.error_to_string ~ok:(fun (a, s) -> join [option_int (U256.to_int a); stack_text s])
        | "3" -> Evm_stack.pop2 stack |> Result.fold ~error:Evm_stack.error_to_string ~ok:(fun (a, b, s) -> join [option_int (U256.to_int a); option_int (U256.to_int b); stack_text s])
        | "4" -> Evm_stack.pop3 stack |> Result.fold ~error:Evm_stack.error_to_string ~ok:(fun (a, b, c, s) -> join [option_int (U256.to_int a); option_int (U256.to_int b); option_int (U256.to_int c); stack_text s])
        | "5" -> Depth.of_int depth |> Option.fold ~none:"none-depth" ~some:(fun d -> stack_result (Evm_stack.dup d stack))
        | "6" -> Depth.of_int depth |> Option.fold ~none:"none-depth" ~some:(fun d -> stack_result (Evm_stack.swap d stack))
        | unknown -> "error:bad op:" ^ unknown))
  | ["extent"; offset; length] -> let* offset = integer offset in let* length = integer length in Ok (option_int (Memory.words_needed ~offset ~length))
  | ["memory"; offset; value; byte; source] -> let* offset = integer offset in let* value = word value in let* byte = integer byte in let* source = unhex source in
    let third = Memory.store_bytes (Memory.store_byte (Memory.store_word Memory.empty offset value) (offset + 31) byte) ~offset:(offset + 1) source in
    let expanded = Memory.expand third 3 in
    let cleared = Memory.store_bytes expanded ~offset (String.make 40 '\000') in
    Ok (join [U256.to_hex (Memory.load_word expanded offset); hex (Memory.slice expanded ~offset ~length:40); string_of_int (Memory.words expanded);
      string_of_int (Memory.size_bytes expanded); string_of_bool (Memory.equal cleared (Memory.expand Memory.empty 3));
      string_of_bool (Memory.equal expanded (Memory.expand expanded 2)); string_of_bool (Memory.equal expanded third)])
  | ["costs"; n; m; topics] -> let* n = integer n in let* m = integer m in let* topics = integer topics in
    Ok (Topic_count.of_int topics |> Option.fold ~none:"none-topic" ~some:(fun topics ->
      join [option_int (Gas.memory_cost n); option_int (Gas.expansion_cost ~current:n ~next:m); string_of_int (Gas.words_of_length n);
        string_of_int (Gas.copy_cost n); string_of_int (Gas.copy_cost_verylow n); string_of_int (Gas.keccak_word_cost n);
        option_int (Gas.log_dynamic_cost ~topics ~length:n); string_of_int (Gas.initcode_cost n); string_of_int (Gas.create_cost ~salted:false n);
        string_of_int (Gas.create_cost ~salted:true n); string_of_int (Gas.code_deposit_cost n);
        option_int (Option.bind (Gas.of_int n) (Gas.charge m)); string_of_int (Refund.to_int (Refund.add (Refund.add Refund.zero n) m)); string_of_int (Gas.give_back m n)]))
  | ["static"; byte] -> let* byte = integer byte in Ok (Opcode.decode byte |> Option.fold ~none:"none" ~some:(fun op -> string_of_int (Gas.static_cost op)))
  | ["sstore"; a; b; c; cold] -> let* original = word a in let* present = word b in let* updated = word c in
    let state = Sstore_state.make ~original ~present ~updated in
    let warmth = if cold = "0" then Access.Warm else Access.Cold in
    let classification = match Sstore_state.classify state with Sstore_state.No_op -> "noop" | Sstore_state.Dirty -> "dirty" | Sstore_state.Fresh_set -> "set" | Sstore_state.Fresh_reset -> "reset" in
    Ok (join [classification; string_of_int (Gas.sstore_dynamic_cost warmth state); string_of_int (Gas.sstore_refund state);
      string_of_int (Gas.storage_access_cost warmth); string_of_int (Gas.account_access_cost warmth); string_of_int (Gas.delegation_cost (Some warmth));
      string_of_int (Gas.delegation_cost None); string_of_bool (Sstore_state.equal state state)])
  | ["call"; remaining; requested; value; cold; had; exists] -> let* remaining = integer remaining in let* requested = word requested in let* value = word value in
    Ok (Gas.of_int remaining |> Option.fold ~none:"none" ~some:(fun remaining ->
      let call = Gas.call_gas ~requested ~remaining ~value in let create = Gas.create_gas remaining in
      let warmth = if cold = "0" then Access.Warm else Access.Cold in
      let entry = Gas.sstore_entry remaining |> Result.fold ~ok:string_of_int ~error:(function Gas.Reentrancy_sentry -> "sentry" | Gas.Insufficient -> "insufficient") in
      join [string_of_int call.charge; string_of_int call.forwarded; string_of_int create.charge; string_of_int create.forwarded;
        string_of_int (Gas.call_value_cost value); string_of_int (Gas.new_account_cost ~value);
        string_of_int (Gas.selfdestruct_dynamic warmth ~had_value:(had = "1") ~beneficiary_exists:(exists = "1")); string_of_int (Gas.exp_cost requested); entry]))
  | ["access"; a; b; slot; prewarm] -> let* a = parse_address a in let* b = parse_address b in let* slot = word slot in let* prewarm = integer prewarm in
    let addresses = if prewarm mod 2 = 1 then [a; a] else [] in let slots = if prewarm > 1 then [a, slot; a, slot] else [] in
    let initial = Access.of_transaction ~addresses ~slots in
    let a1, state = Access.touch_account initial a in let a2, state = Access.touch_account state a in
    let s1, state = Access.touch_slot state a slot in let s2, state = Access.touch_slot state a slot in let s3, state = Access.touch_slot state b slot in
    let expected = Access.of_transaction ~addresses:[a] ~slots:[b, slot; a, slot] in
    Ok (join [string_of_bool (Access.is_cold a1); string_of_bool (Access.is_cold a2); string_of_bool (Access.is_cold s1); string_of_bool (Access.is_cold s2);
      string_of_bool (Access.is_cold s3); string_of_bool (Access.mem_account state b); string_of_bool (Access.mem_slot state b slot); string_of_bool (Access.equal expected state)])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
