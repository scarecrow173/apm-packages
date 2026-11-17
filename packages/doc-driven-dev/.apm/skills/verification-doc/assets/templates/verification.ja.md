# {{title}}

## 目的

<!-- この検証設計が守る検証意図: どのクレームを検証し、
     いつこの設計を退役させられるか。 -->

## 範囲

<!-- この設計が検証するクレーム・契約・振る舞い —— およびその境界。 -->

## 検証項目

<!-- 権威ある検証項目リストはフロントマターの `checks:` 配列です ——
     Check→Claim の唯一の権威。各エントリは VerificationCheckV1
     { id, target, method, implementation, preconditions, passCriteria,
     limitations, required } で、`id` は安定した CHK-NN キー、`target` は
     修飾クレーム参照 (DOC-ID::KEY)、`method` は unit / integration /
     e2e / property / static / model-checking / formal-proof /
     runtime-monitoring / manual-review のいずれか、そして
     `passCriteria.kind` は `method` と一致しなければなりません。
     各検証項目の意図をここに散文で記述し、HTML コメント内の
     check:CHK-NN 形式の本文アンカーでフロントマターの id に結び付けます。 -->

## 対象外

<!-- この設計が意図的に検証しないこと。 -->
