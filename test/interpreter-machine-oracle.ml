open Oracle_bytes
module Evm_stack = Stack
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word_codec = Bcs.refine ~inject:(fun raw -> U256.of_be_bytes raw |> Option.to_result ~none:"bad word") ~project:U256.to_be_bytes (Bcs.fixed_bytes 32)
let stack_codec = Bcs.list word_codec
let transition = function
  | Interpreter.Halt outcome -> (match outcome with
      | Interpreter.Stopped { gas_left; effects } -> let _ = gas_left, effects in Interpreter.outcome_to_string outcome
      | Interpreter.Returned { output; gas_left; effects } -> let _ = gas_left, effects in Interpreter.outcome_to_string outcome ^ ":" ^ hex output
      | Interpreter.Reverted { output; gas_left } -> let _ = gas_left in Interpreter.outcome_to_string outcome ^ ":" ^ hex output
      | Interpreter.Failed error -> let _ = error in Interpreter.outcome_to_string outcome)
  | Interpreter.Continue machine -> String.concat ":" ["continue"; string_of_int machine.pc; hex (Bcs.encode stack_codec (Evm_stack.to_list machine.stack));
      string_of_int (Gas.remaining machine.gas); string_of_int (Memory.words machine.memory); hex (Memory.slice machine.memory ~offset:0 ~length:128)]
let body op width code (machine : Interpreter.machine) = match op with
  | 0 -> Interpreter.unary Alu.lognot machine
  | 1 -> Interpreter.binary Alu.sub machine
  | 2 -> Interpreter.ternary Alu.addmod machine
  | 3 -> Interpreter.exponentiate machine
  | 4 -> Interpreter.mload machine
  | 5 -> Interpreter.mstore ~length:32 ~write:Memory.store_word machine
  | 6 -> Interpreter.mstore ~length:1 ~write:(fun memory offset value -> Memory.store_byte memory offset (Interpreter.low_byte value)) machine
  | 7 -> Interpreter.jump code machine
  | 8 -> Interpreter.jumpi code machine
  | 9 -> Interpreter.push_immediate code width machine
  | 10 -> Interpreter.halt_with_output (fun output gas_left -> Interpreter.Returned { output; gas_left; effects = machine.effects }) machine
  | 11 -> Interpreter.halt_with_output (fun output gas_left -> Interpreter.Reverted { output; gas_left }) machine
  | 12 -> Interpreter.copy_from_data (Code.window code) machine
  | 13 -> Interpreter.mcopy machine
  | 14 -> Interpreter.discard machine
  | unknown -> let _ = unknown in Interpreter.push_value U256.zero machine
let dispatch line = match String.split_on_char ' ' line with
  | [op; width; stack; gas; code; pc; memory; paid] -> let* op = integer op in let* width = integer width in let* stack = unhex stack in
    let* words = Bcs.decode stack_codec stack |> Result.map_error Bcs.error_to_string in let* gas = integer gas in let* code = unhex code in let* pc = integer pc in let* memory = unhex memory in let* paid = integer paid in
    Ok (Evm_stack.of_list words |> Option.fold ~none:"none-stack" ~some:(fun stack -> Gas.of_int gas |> Option.fold ~none:"none-gas" ~some:(fun gas ->
      let machine : Interpreter.machine = { pc; stack; memory = Memory.expand (Memory.store_bytes Memory.empty ~offset:0 memory) paid; gas; effects = Effects.start ~world:World_state.empty ~access:Access.empty; return_data = Return_data.empty } in
      transition (body op width (Code.of_string code) machine))))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
