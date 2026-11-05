// clipimg.exe — 클립보드 그림을 PNG로 저장하고 클립보드를 '복사한 파일'로 바꾼다 (herdr image-paste mod용).
// herdr 앱은 Windows 로컬 창에 클립보드 글자만 붙이지만, 복사한 파일은 끌어다 놓은 것처럼 경로를 넣어 준다.
// 출력: 저장한 경로(종료 0) / 그림 없음(종료 2) / 오류(종료 1). PowerShell보다 훨씬 빨리 뜨도록 C#으로 컴파일해 둔다.
// 빌드: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /out:clipimg.exe clipimg.cs
using System;
using System.Collections.Specialized;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

static class ClipImg
{
    // 한글 사용자 폴더를 피해 ASCII 경로에 둔다 (Claude가 경로를 그림으로 읽기 쉽게)
    const string Dir = @"C:\Users\Public\herdr-paste";
    const int KeepDays = 1;

    [STAThread]
    static int Main()
    {
        try
        {
            if (!Clipboard.ContainsImage()) return 2;
            Image img = Clipboard.GetImage();
            if (img == null) return 2;
            Directory.CreateDirectory(Dir);
            Cleanup();
            string path = Path.Combine(Dir, "paste-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + ".png");
            img.Save(path, ImageFormat.Png);
            var files = new StringCollection();
            files.Add(path);
            Clipboard.SetFileDropList(files);
            Console.Out.Write(path);
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.Write(e.Message);
            return 1;
        }
    }

    static void Cleanup()
    {
        foreach (var f in Directory.GetFiles(Dir, "paste-*.png"))
        {
            try { if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-KeepDays)) File.Delete(f); } catch { }
        }
    }
}
