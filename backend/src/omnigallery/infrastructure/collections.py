def unique_by(seq, key_func=lambda x: x):
    seen = set()
    return [x for x in seq if (key := key_func(x)) not in seen and not seen.add(key)]


def find(lst, comparator):
    return next((item for item in lst if comparator(item)), None)


def find_index(lst, comparator):
    return next((i for i, item in enumerate(lst) if comparator(item)), -1)


def omit(d, keys):
    return {k: v for k, v in d.items() if k not in keys}


def case_insensitive_get(d, key, default=None):
    for k, v in d.items():
        if k.lower() == key.lower():
            return v
    return default


def map_dict_keys(value_dict, map_dict=None):
    if map_dict is None:
        return value_dict
    else:
        return {map_dict.get(key, key): value for key, value in value_dict.items()}
