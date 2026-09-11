open Oracle_bytes
module Evm_stack = Stack
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let dispatch line = match String.split_on_char ' ' line with
  | ["logs"; available; count; address; data] -> let* available = integer available in let* count = integer count in let* address = unhex address in let* data = unhex data in
    let* address = Option.to_result ~none:"bad address" (Units.Address.of_bytes address) in
    Ok (Topic_count.of_int count |> Option.fold ~none:"none-topic" ~some:(fun count ->
      Evm_stack.of_list (List.init available (fun i -> U256.of_int (available - i - 1) |> Option.value ~default:U256.zero)) |> Option.fold ~none:"none-stack" ~some:(fun stack ->
        Log.Topics.collect count ~pop:Evm_stack.pop stack |> Result.fold ~error:Evm_stack.error_to_string ~ok:(fun (topics, remaining) ->
          let first = Log.make ~address ~topics ~data in let second = Log.make ~address ~topics:Log.Topics.T0 ~data:"" in
          let journal = Log_journal.append (Log_journal.append Log_journal.empty first) second in
          String.concat ":" [string_of_int (Topic_count.to_int (Log.Topics.arity topics)); string_of_int (Evm_stack.depth remaining); Log.to_string first;
            (Log_journal.to_list journal |> List.map (fun entry -> Log.to_string entry ^ "|") |> String.concat ""); string_of_int (Log_journal.length journal);
            string_of_bool (Log_journal.equal journal journal); string_of_bool (Log_journal.equal journal Log_journal.empty); string_of_bool (Log.equal first second)]))))
  | ["return"; raw; offset; length] -> let* raw = unhex raw in let* offset = integer offset in let* length = integer length in
    if offset < 0 then Error "negative offset" else if length < 0 then Error "negative length" else
    let data = Return_data.of_string raw in Ok (string_of_int (Return_data.size data) ^ ":" ^ Option.fold ~none:"none" ~some:hex (Return_data.read data ~offset ~length))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
