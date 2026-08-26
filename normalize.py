"""
توحيد مقاسات صور المعالم بدون أي تغيير في محتواها.

قصّ ذكيّ من المركز + تصغير + حفظ. لا يضيف ولا يحذف ولا يرمّم شيئاً —
وهو الفرق الجوهري بينه وبين تمرير الصور على نموذج توليدي.

    pip install pillow
    python normalize.py raw/ out/                 # كل المقاسات
    python normalize.py raw/ out/ --slot card     # مقاس واحد

يقرأ كل صورة في مجلد raw/ ويكتب النسخ في out/<slot>/.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# طرفية ويندوز تفتح على cp1252 فتنهار عند طباعة العربية. أجبرها على UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    from PIL import Image, ImageOps, ImageStat, ImageFilter, ImageEnhance
except ImportError:
    sys.exit("ينقصك Pillow.  شغّل:  pip install pillow")

# (العرض، الارتفاع، جودة JPEG) — مطابقة لما يستهلكه الموقع فعلاً
SLOTS = {
    "card":       (1000, 1250, 82),   # بطاقة البولارويد
    "full":       (1600, 2000, 88),   # العرض الكامل عند الضغط
    "hero":       (1920, 1080, 88),   # شرائح الغلاف — 16:9 مثل معظم لقطات الدرون
    "panel":      (1200, 1800, 86),   # ألواح «كيف تُقرأ المدينة»
    "background": (2400, 1500, 84),   # خلفيات الأقسام
    "paper":      (900, 1200, 86),    # داخل الكولاج الورقي
}

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


def enhance(im: Image.Image, strength: float = 1.0) -> Image.Image:
    """
    تحسين جودة حسابي بحت: توازن أبيض، مستويات، حدّة.

    كل عملية هنا تحويل رياضي على البكسلات الموجودة — لا يمكنها أن تخترع
    حجراً أو نافذة أو ترمّم ضرراً، مهما بالغت في القيم. هذا هو الفرق
    الجوهري عن تمرير الصورة على نموذج توليدي.
    """
    if im.mode != "RGB":
        im = im.convert("RGB")

    def grey_world(img: Image.Image, pull: float) -> Image.Image:
        """يسحب متوسطات القنوات نحو بعضها. pull=1 تصحيح كامل، 0 بلا تغيير."""
        r, g, b = ImageStat.Stat(img).mean
        if min(r, g, b) <= 1:      # صورة شبه سوداء: لا تعبث بها
            return img
        grey = (r + g + b) / 3
        lut = []
        for mean in (r, g, b):
            k = 1 + (grey / mean - 1) * pull
            lut += [min(255, int(v * k + 0.5)) for v in range(256)]
        return img.point(lut)

    # 1) توازن أبيض قبل المدّ: لو تُرك الميل كما هو فالمدّ يضخّمه وقد يُشبع
    #    قناة كاملة، وعندها تضيع المعلومة ولا ينفع تصحيح بعدها.
    #    جزئي عمداً حتى لا يُفقد دفء ضوء العصر، وهو جزء من المشهد لا خطأ فيه.
    im = grey_world(im, 0.7 * strength)

    # 2) مدّ المستويات مع قصّ 0.4% فقط من الطرفين — يفتح الصورة الباهتة
    #    دون حرق السماء ولا سدّ الظلال. preserve_tone يمنع انزياح الألوان.
    im = ImageOps.autocontrast(im, cutoff=0.4 * strength, preserve_tone=True)

    # 3) تمريرة توازن أخيرة خفيفة تلتقط ما ضخّمه المدّ.
    im = grey_world(im, 0.5 * strength)

    # 4) رفع تشبّع خفيف جداً لتعويض ما يبهته مدّ المستويات
    im = ImageEnhance.Color(im).enhance(1 + 0.06 * strength)

    return im


def sharpen_for_output(im: Image.Image, strength: float = 1.0) -> Image.Image:
    """حدّة بمقاس الإخراج — تُطبَّق بعد التصغير وإلا ضاع أثرها."""
    radius = max(0.6, im.width / 1600)
    return im.filter(ImageFilter.UnsharpMask(
        radius=radius, percent=int(65 * strength), threshold=3))


def normalize(src: Path, dst: Path, w: int, h: int, quality: int,
              do_enhance: bool = False, strength: float = 1.0) -> tuple[int, int]:
    with Image.open(src) as im:
        # الصور من الهواتف تحمل دوران في EXIF — بدون هذا تخرج مقلوبة
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")

        original = im.size

        # التحسين قبل التصغير: المعالجة على البكسلات الأصلية أدقّ
        if do_enhance:
            im = enhance(im, strength)

        # يقصّ من المركز للنسبة المطلوبة ثم يصغّر — بلا تشويه
        out = ImageOps.fit(im, (w, h), method=Image.LANCZOS, centering=(0.5, 0.45))

        if do_enhance:
            out = sharpen_for_output(out, strength)

        dst.parent.mkdir(parents=True, exist_ok=True)
        out.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
        return original


def slugify(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in name.lower()).strip("-")


def main() -> int:
    p = argparse.ArgumentParser(description="توحيد مقاسات صور المعالم")
    p.add_argument("src", type=Path, help="مجلد الصور الأصلية")
    p.add_argument("out", type=Path, help="مجلد الإخراج")
    p.add_argument("--slot", choices=sorted(SLOTS), action="append",
                   help="مقاس واحد فقط (يمكن تكراره). الافتراضي: كل المقاسات")
    p.add_argument("--enhance", action="store_true",
                   help="تحسين الجودة: توازن أبيض، مستويات، حدّة. لا يغيّر أي ملمح")
    p.add_argument("--strength", type=float, default=1.0,
                   help="قوة التحسين 0.5 خفيف / 1.0 افتراضي / 1.5 قوي")
    args = p.parse_args()

    if not 0 <= args.strength <= 2:
        return "‏--strength لازم بين 0 و 2"

    if not args.src.is_dir():
        return f"المجلد غير موجود: {args.src}"

    photos = sorted(f for f in args.src.iterdir()
                    if f.is_file() and f.suffix.lower() in EXTS)
    if not photos:
        return f"لا توجد صور في {args.src}"

    slots = args.slot or list(SLOTS)
    small: list[str] = []

    for photo in photos:
        slug = slugify(photo.stem)
        for slot in slots:
            w, h, q = SLOTS[slot]
            dst = args.out / slot / f"{slug}.jpg"
            ow, oh = normalize(photo, dst, w, h, q, args.enhance, args.strength)
            # تكبير صورة صغيرة لا يضيف تفاصيل — يضيف ضبابية فقط
            if ow < w or oh < h:
                small.append(f"  {photo.name} ({ow}x{oh}) -> {slot} ({w}x{h})")
            print(f"{slot:11} {slug}.jpg")

    print(f"\nتم: {len(photos)} صورة × {len(slots)} مقاس = {len(photos)*len(slots)} ملف")
    if small:
        print("\nتنبيه — هذه الأصول أصغر من المقاس المطلوب، فكُبّرت وستبدو أنعم:")
        print("\n".join(sorted(set(small))))
        print("صوّرها من جديد بدقة أعلى إن أمكن.")
    return 0


def demo() -> None:
    """فحص ذاتي: يتأكد أن المخرجات بالمقاس المطلوب بالضبط ودون تشويه."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # مصدر بنسبة غريبة عمداً (عريض جداً) ليختبر القصّ
        src = tmp / "test.jpg"
        Image.new("RGB", (3000, 1000), (90, 110, 120)).save(src)

        for slot, (w, h, q) in SLOTS.items():
            dst = tmp / "out" / f"{slot}.jpg"
            normalize(src, dst, w, h, q)
            with Image.open(dst) as got:
                assert got.size == (w, h), f"{slot}: خرج {got.size} بدل {(w, h)}"

        # EXIF transpose يجب ألا يكسر صورة بلا EXIF
        assert normalize(src, tmp / "out" / "again.jpg", 100, 100, 80) == (3000, 1000)

        # --- إثبات أن التحسين لا يخترع بنية ---
        # صورة بحوافّ حادّة تمثّل «ملامح» المبنى
        feat = Image.new("RGB", (400, 400), (40, 44, 48))
        for x in range(120, 180):          # عمود
            for y in range(80, 320):
                feat.putpixel((x, y), (210, 200, 185))
        for x in range(250, 310):          # عمود ثانٍ
            for y in range(80, 320):
                feat.putpixel((x, y), (210, 200, 185))

        after = enhance(feat, 1.0)
        assert after.size == feat.size, "التحسين غيّر المقاس"

        # الأعمدة تبقى عمودين: نعدّ الانتقالات على سطر أفقي واحد
        def edges(img, row=200):
            px = [img.getpixel((x, row))[0] for x in range(img.width)]
            mid = (min(px) + max(px)) / 2
            return sum(1 for i in range(1, len(px))
                       if (px[i - 1] < mid) != (px[i] < mid))

        assert edges(feat) == edges(after) == 4, \
            f"تغيّر عدد الحواف: {edges(feat)} -> {edges(after)}"

        # وأي قوة مهما بولغ فيها لا تضيف ولا تحذف حافّة
        for s in (0.5, 1.5, 2.0):
            assert edges(enhance(feat, s)) == 4, f"القوة {s} غيّرت البنية"

        # --- وأن التحسين ملموس على صورة تشبه صورة حقيقية ---
        import random
        random.seed(7)
        real = Image.new("RGB", (600, 450))
        px = real.load()
        for y in range(450):                       # تباين معقول + ميل بارد
            for x in range(0, 600, 3):
                base = max(8, min(247, 110 + random.gauss(0, 45)))
                v = (int(base), int(base * 1.05), int(min(255, base * 1.28)))
                for dx in range(3):
                    if x + dx < 600:
                        px[x + dx, y] = v

        b4, af = ImageStat.Stat(real), ImageStat.Stat(enhance(real, 1.0))
        contrast = lambda s: sum(s.stddev) / 3
        cast = lambda s: max(s.mean) / max(min(s.mean), 1)   # مستقل عن السطوع

        assert contrast(af) > contrast(b4), "التباين لم يتحسّن"
        assert cast(af) < cast(b4), "الميل اللوني لم يُصحَّح"
        assert cast(af) < 1.10, f"بقي ميل لوني: {cast(af):.3f}"

    print("demo ok — المقاسات مضبوطة، التحسين ملموس، والملامح لم تتغيّر")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
    else:
        sys.exit(main())
