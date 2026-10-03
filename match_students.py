import difflib
import re
import unicodedata

import pandas as pd

STUDENTS = r"C:\Users\LUBS\Documents\Boat\Spensa\Boat Students7.xlsx"
PAYMENTS = r"C:\Users\LUBS\Documents\Boat\Spensa\Fees Payments\Stanbic unmatched 300926.xlsx"


def tokens(value):
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return tuple(sorted(re.findall(r"[a-z0-9]+", text)))


students = pd.read_excel(STUDENTS, sheet_name="Students", dtype=str).fillna("")
payments = pd.read_excel(PAYMENTS, dtype=str).fillna("")
students["tokens"] = students.apply(lambda row: tokens(" ".join([row["first_name"], row["last_name"]])), axis=1)
students["all_tokens"] = students.apply(
    lambda row: tokens(" ".join([row["first_name"], row["last_name"], row["other_names"]])), axis=1
)
students["name"] = students.apply(
    lambda row: " ".join(x for x in [row["first_name"], row["last_name"], row["other_names"]] if x), axis=1
)
records = students.to_dict("records")
by_tokens = {}
for record in records:
    for key in {record["tokens"], record["all_tokens"]}:
        by_tokens.setdefault(key, []).append(record)

print(f"Payments: {len(payments)} | Students: {len(students)}")
for _, payment in payments.iterrows():
    payment_tokens = tokens(payment["Student"])
    payment_set = set(payment_tokens)
    exact = by_tokens.get(payment_tokens, [])
    if not exact:
        exact = [record for record in records if payment_set.issubset(set(record["all_tokens"]))]
    if len(exact) == 1:
        student = exact[0]
        print(
            "MATCH|{payment}|{student_name}|{admission}|{schoolpay}|{reference}".format(
                payment=payment["Student"],
                student_name=student["name"],
                admission=student["admission_number"],
                schoolpay=student["school_pay_number"],
                reference=payment["Bank Reference"],
            )
        )
    else:
        shared_token_indices = [
            index
            for index, record in enumerate(records)
            for candidate_tokens in [record["all_tokens"]]
            if payment_set.intersection(candidate_tokens)
        ]
        candidate_indices = shared_token_indices or list(range(len(records)))
        candidates = sorted(
            (
                (max(
                    difflib.SequenceMatcher(None, " ".join(payment_tokens), " ".join(records[index]["tokens"])).ratio(),
                    difflib.SequenceMatcher(None, " ".join(payment_tokens), " ".join(records[index]["all_tokens"])).ratio(),
                ), index)
                for index in candidate_indices
            ),
            reverse=True,
        )[:3]
        suggestions = " ; ".join(
            f"{score:.3f}:{records[index]['name']}:{records[index]['admission_number']}:{records[index]['school_pay_number']}"
            for score, index in candidates
        )
        print(f"CHECK|{payment['Student']}|exact={len(exact)}|{suggestions}")
