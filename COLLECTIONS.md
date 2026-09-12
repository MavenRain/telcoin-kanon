The Round and Authority map/set APIs use persistent canonical lists. Construct
them with `roundSetOfList`, `authoritySetOfList`, `roundMapOfList`, or
`authorityMapOfList`, supplying the concrete sequence dictionary. Sets sort and
deduplicate input. Maps sort keys and retain the last value for a repeated key.

`OrderedSet A L` stores a sequence dictionary, comparator and canonical elements.
`OrderedMap K V L` stores the corresponding key/value dictionary, key comparator
and canonical bindings. Binary operations require the same key ordering. Use
checked scalar constructors for untrusted keys. Raw tuple construction bypasses
the canonical-list invariant, as raw constructors do elsewhere in this port.

```text
def seen : OrderedSet Round RoundValues :=
  roundSetOfList RoundValues seqRoundValueOps
    (seqRoundValueCons roundGenesis seqRoundValueEmpty)
def containsGenesis : Bool := orderedSetMem Round RoundValues roundGenesis seen
```

The generic operations take erased type arguments followed by ordinary values.
For example, `orderedMapAdd Round Nat RoundNatEntries key value map` returns a
new map. Value-changing `Map`, `Mapi`, `FilterMap` and `Merge` also take the output
carrier's dictionary. `AddToList` takes the value-list dictionary and prepends,
preserving repeated values. Fold callbacks receive keys in ascending order and
carry explicit state; they can also compose the durable effect type.

| OCaml operation | Kanon suffix after `orderedSet` or `orderedMap` |
| --- | --- |
| empty, singleton, cardinal, is_empty | `Empty`, `Singleton`, `Cardinal`, `IsEmpty` |
| add, remove, mem | `Add`, `Remove`, `Mem` |
| find / find_opt | `FindOpt`, returning `ValueOption` |
| min_elt / min_binding and optional variants | `MinOpt` |
| max_elt / max_binding and optional variants | `MaxOpt` |
| choose and choose_opt | `ChooseOpt` |
| find_first / find_last and optional variants | `FindFirstOpt`, `FindLastOpt` |
| equal, compare, filter, partition, split | `Equal`, `Compare`, `Filter`, `Partition`, `Split` |
| for_all, exists, fold, iter | `ForAll`, `Exists`, `Fold`, `Iter` |
| map, filter_map | `Map`, `FilterMap` |
| of_list, to_list, of_seq, to_seq, to_rev_seq, to_seq_from, add_seq | `OfList`, `ToList`, `OfSeq`, `ToSeq`, `ToRevSeq`, `ToSeqFrom`, `AddSeq` |
| Set.elements, union, inter, diff, subset, disjoint | `Elements`, `Union`, `Inter`, `Diff`, `Subset`, `Disjoint` |
| Map.bindings, update, add_to_list, merge, union, mapi | `Bindings`, `Update`, `AddToList`, `Merge`, `Union`, `Mapi` |

Exception-raising searches share the total optional query in Kanon. Sequence
adapters use finite concrete carriers in their specified order, with eager
construction. They do not model OCaml's lazy or infinite `Seq.t`. Predicates for
first/last searches retain the source's monotonicity precondition. `Iter` uses
the nominal `CodecUnit`; stateful work belongs in `Fold`.

The representation preserves values and ordering, with different costs from
OCaml's balanced trees. Search is linear, and repeated insertion or sorting can
be quadratic. Physical identity and tree sharing are not part of this API.
