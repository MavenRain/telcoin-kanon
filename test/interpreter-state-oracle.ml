open Oracle_bytes
module Evm_stack = Stack
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let small n = U256.of_int n |> Option.value ~default:U256.zero
let a = Address_word.of_word (small 1)
let b = Address_word.of_word (small 2)
let slot = U256.one
let word_codec = Bcs.refine ~inject:(fun raw -> U256.of_be_bytes raw |> Option.to_result ~none:"bad word") ~project:U256.to_be_bytes (Bcs.fixed_bytes 32)
let stack_codec = Bcs.list word_codec
let spec = function 0 -> Spec.Shanghai | 1 -> Spec.Cancun | unknown -> let _ = unknown in Spec.Prague
let env fork mode =
  let block = Env.Block.make_at_spec ~spec:(spec fork) ~coinbase:a ~timestamp:(small 10) ~number:(small 11) ~prevrandao:(small 12) ~gas_limit:(small 1000000)
    ~basefee:(small 14) ~basefee_address:b ~chain_id:(small 15) ~blob_gasprice:Env.Block.consensus_blob_gasprice ~hashes:Block_hashes.empty in
  let tx = Env.Tx.make ~origin:b ~gas_price:(small 21) ~access_list:[] in
  let call = Env.Call.make ~target:a ~caller:b ~value:(small 22) ~data:(Data.of_string "abc") ~mutability:(if mode = 0 then Mutability.Mutable else Mutability.Static) in
  Env.make ~block ~tx ~call
let effects warm phase =
  let world = World_state.set_storage (World_state.set_account World_state.empty a (Account.make ~nonce:Nonce.zero ~balance:(small 8))) a slot (small 9) in
  let initial = Effects.start ~world ~access:(Access.of_transaction ~addresses:(if warm = 0 then [] else [a]) ~slots:(if warm = 2 then [a, slot] else [])) in
  let prepared = match phase with
    | 2 -> Effects.begin_creation initial Mutability.Permit ~creator:b ~created:a ~value:U256.zero |> Option.value ~default:initial
    | 1 -> Effects.commit_store (Effects.plan_store initial Mutability.Permit a ~slot ~value:(small 3))
    | unknown -> let _ = unknown in initial in
  Effects.transient_store (Effects.deploy_code prepared Mutability.Permit a "\x60\x01") Mutability.Permit a ~slot ~value:(small 5)
let account account = String.concat ":" [U256.to_hex (Account.balance account); Nonce.to_string (Account.nonce account); U256.to_hex (Account.slot account slot); hex (Account.code account)]
let summary effects =
  let world = Effects.world effects in let access = Effects.access effects in let lifecycle = Effects.lifecycle effects in
  String.concat ":" [account (World_state.account world a); account (World_state.account world b); U256.to_hex (World_state.storage (Effects.base effects) a slot);
    string_of_int (Refund.to_int (Effects.refund effects)); string_of_int (Log_journal.length (Effects.logs effects)); U256.to_hex (Effects.transient_load effects a ~slot);
    string_of_bool (Lifecycle.created_here lifecycle a); string_of_bool (Lifecycle.created_here lifecycle b);
    (Lifecycle.destroyed lifecycle |> List.map (fun a -> hex (Units.Address.to_bytes a) ^ ",") |> String.concat "");
    string_of_bool (Access.mem_account access a); string_of_bool (Access.mem_account access b); string_of_bool (Access.mem_slot access a slot); string_of_bool (Effects.equal effects effects)]
  ^ "|logs:" ^ (Log_journal.to_list (Effects.logs effects) |> List.map (fun log -> Log.to_string log ^ ";") |> String.concat "")
let transition tr =
  let text, effects = match tr with
    | Interpreter.Halt outcome -> (match outcome with
      | Interpreter.Stopped { gas_left; effects } -> let _ = gas_left in Interpreter.outcome_to_string outcome, summary effects
      | Interpreter.Returned { output; gas_left; effects } -> let _ = gas_left in Interpreter.outcome_to_string outcome ^ ":" ^ hex output, summary effects
      | Interpreter.Reverted { output; gas_left } -> let _ = gas_left in Interpreter.outcome_to_string outcome ^ ":" ^ hex output, "discarded"
      | Interpreter.Failed error -> let _ = error in Interpreter.outcome_to_string outcome, "discarded")
    | Interpreter.Continue machine -> String.concat ":" ["continue"; string_of_int machine.pc; hex (Bcs.encode stack_codec (Evm_stack.to_list machine.stack));
        string_of_int (Gas.remaining machine.gas); string_of_int (Memory.words machine.memory); hex (Memory.slice machine.memory ~offset:0 ~length:128)], summary machine.effects in
  text ^ "|effects:" ^ effects
let topics = function 0 -> Topic_count.Zero | 1 -> Topic_count.One | 2 -> Topic_count.Two | 3 -> Topic_count.Three | unknown -> let _ = unknown in Topic_count.Four
let body op count env machine = match op with
  | 0 -> Interpreter.balance machine
  | 1 -> Interpreter.sload env machine
  | 2 -> Interpreter.selfbalance env machine
  | 3 -> Interpreter.extcodesize machine
  | 4 -> Interpreter.extcodehash machine
  | 5 -> Interpreter.extcodecopy machine
  | 6 -> Interpreter.keccak256 machine
  | 7 -> Interpreter.log (topics count) env machine
  | 8 -> Interpreter.tload env machine
  | 9 -> Interpreter.tstore env machine
  | 10 -> Interpreter.sstore env machine
  | 11 -> Interpreter.returndatacopy machine
  | 12 -> Interpreter.blockhash env machine
  | unknown -> let _ = unknown in Interpreter.selfdestruct env machine
let dispatch line = match String.split_on_char ' ' line with
  | [op; count; stack; gas; fork; mode; warm; phase; returned; memory] ->
    let* op = integer op in let* count = integer count in let* stack = unhex stack in
    let* words = Bcs.decode stack_codec stack |> Result.map_error Bcs.error_to_string in
    let* gas = integer gas in let* fork = integer fork in let* mode = integer mode in let* warm = integer warm in let* phase = integer phase in
    let* returned = unhex returned in let* memory = unhex memory in
    Ok (Evm_stack.of_list words |> Option.fold ~none:"none-stack" ~some:(fun stack -> Gas.of_int gas |> Option.fold ~none:"none-gas" ~some:(fun gas ->
      let machine : Interpreter.machine = { pc = 0; stack; memory = Memory.store_bytes Memory.empty ~offset:0 memory; gas; effects = effects warm phase; return_data = Return_data.of_string returned } in
      transition (body op count (env fork mode) machine))))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
