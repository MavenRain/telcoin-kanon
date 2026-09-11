open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let outcome = function
  | Precompile.Succeeded { gas_used; output } -> "s:" ^ string_of_int gas_used ^ ":" ^ hex output
  | Precompile.Rejected -> "rejected" | Precompile.Not_a_precompile -> "not-precompile"
let invoke address input gas_limit = match address with
  | 4 -> Precompile.identity ~input ~gas_limit | 6 -> Precompile.ecadd ~input ~gas_limit
  | 7 -> Precompile.ecmul ~input ~gas_limit | 8 -> Precompile.ecpairing ~input ~gas_limit
  | _ -> Precompile.Not_a_precompile
let dispatch line = match String.split_on_char ' ' line with
  | [address; gas; bytes] -> let* address = integer address in let* gas = integer gas in let* bytes = unhex bytes in Ok (outcome (invoke address bytes gas))
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let golden row =
  let expected = match row.Bn254_vectors.expect with
    | Bn254_vectors.Succeeds { gas_used; output_hex } -> "s:" ^ string_of_int gas_used ^ ":" ^ output_hex
    | Bn254_vectors.Rejects { err } -> let _ = err in "rejected" in
  Printf.printf "%s %d %d %s %s\n" row.name row.addr row.gas_limit row.input_hex expected
let () = match Array.to_list Sys.argv with
  | [_; "goldens"] -> List.iter golden Bn254_vectors.all
  | [] -> () | _ :: _ -> In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
