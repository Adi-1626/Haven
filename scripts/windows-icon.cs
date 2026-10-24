// Replaces the icon groups of a Windows executable with the images of a .ico file.
// Usage: windows-icon.exe <executable> <icon.ico>
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

static class WindowsIcon {
  const uint LoadAsDataFile = 0x2;
  static readonly IntPtr IconType = (IntPtr)3;
  static readonly IntPtr GroupIconType = (IntPtr)14;
  const ushort DefaultLanguage = 1033;

  delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLanguageProc(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc callback, IntPtr param);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLanguageProc callback, IntPtr param);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort language);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr LockResource(IntPtr data);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint SizeofResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

  class Group { public string Name; public int Id; public ushort Language; public List<ushort> Icons = new List<ushort>(); }

  static bool IsIntResource(IntPtr value) { return ((ulong)value.ToInt64() >> 16) == 0; }

  static void WithName(Group group, Action<IntPtr> action) {
    if (group.Name == null) { action((IntPtr)group.Id); return; }
    IntPtr name = Marshal.StringToHGlobalUni(group.Name);
    try { action(name); } finally { Marshal.FreeHGlobal(name); }
  }

  static void Fail(string message) { throw new Exception(message + " (Win32 error " + Marshal.GetLastWin32Error() + ")"); }

  static List<Group> ExistingGroups(string executable) {
    var groups = new List<Group>();
    IntPtr module = LoadLibraryEx(executable, IntPtr.Zero, LoadAsDataFile);
    if (module == IntPtr.Zero) Fail("Could not open " + executable);
    try {
      EnumResourceNames(module, GroupIconType, (m, type, name, param) => {
        string text = IsIntResource(name) ? null : Marshal.PtrToStringUni(name);
        int id = IsIntResource(name) ? name.ToInt32() : 0;
        EnumResourceLanguages(m, type, name, (m2, type2, name2, language, param2) => {
          var group = new Group { Name = text, Id = id, Language = language };
          IntPtr found = FindResourceEx(m2, type2, name2, language);
          IntPtr data = LockResource(LoadResource(m2, found));
          int size = (int)SizeofResource(m2, found);
          var bytes = new byte[size];
          Marshal.Copy(data, bytes, 0, size);
          int count = BitConverter.ToUInt16(bytes, 4);
          for (int index = 0; index < count; index++) group.Icons.Add(BitConverter.ToUInt16(bytes, 6 + index * 14 + 12));
          groups.Add(group);
          return true;
        }, IntPtr.Zero);
        return true;
      }, IntPtr.Zero);
    } finally { FreeLibrary(module); }
    return groups;
  }

  static int Main(string[] args) {
    try {
      if (args.Length != 2) throw new Exception("Usage: windows-icon.exe <executable> <icon.ico>");
      string executable = Path.GetFullPath(args[0]);
      byte[] ico = File.ReadAllBytes(args[1]);
      if (BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1) throw new Exception("Not an .ico file: " + args[1]);
      int count = BitConverter.ToUInt16(ico, 4);
      if (count == 0) throw new Exception("The .ico file has no images");

      List<Group> existing = ExistingGroups(executable);
      var target = existing.Count > 0 ? existing[0] : new Group { Id = 1, Language = DefaultLanguage };

      var directory = new MemoryStream();
      var writer = new BinaryWriter(directory);
      writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)count);
      var images = new List<byte[]>();
      for (int index = 0; index < count; index++) {
        int entry = 6 + index * 16;
        int length = BitConverter.ToInt32(ico, entry + 8);
        int offset = BitConverter.ToInt32(ico, entry + 12);
        var image = new byte[length];
        Buffer.BlockCopy(ico, offset, image, 0, length);
        images.Add(image);
        writer.Write(ico, entry, 8);            // width, height, colors, reserved, planes, bit count
        writer.Write(length);
        writer.Write((ushort)(index + 1));
      }
      writer.Flush();

      IntPtr update = BeginUpdateResource(executable, false);
      if (update == IntPtr.Zero) Fail("Could not edit " + executable);
      bool committed = false;
      try {
        foreach (var group in existing) {
          WithName(group, name => { if (!UpdateResource(update, GroupIconType, name, group.Language, null, 0)) Fail("Could not remove icon group"); });
          foreach (ushort icon in group.Icons) if (!UpdateResource(update, IconType, (IntPtr)icon, group.Language, null, 0)) Fail("Could not remove icon " + icon);
        }
        for (int index = 0; index < images.Count; index++)
          if (!UpdateResource(update, IconType, (IntPtr)(index + 1), target.Language, images[index], (uint)images[index].Length)) Fail("Could not add icon " + (index + 1));
        byte[] groupData = directory.ToArray();
        WithName(target, name => { if (!UpdateResource(update, GroupIconType, name, target.Language, groupData, (uint)groupData.Length)) Fail("Could not add icon group"); });
        if (!EndUpdateResource(update, false)) Fail("Could not save " + executable);
        committed = true;
      } finally { if (!committed) EndUpdateResource(update, true); }

      Console.WriteLine("Applied " + count + " icon images to " + executable + " (replaced " + existing.Count + " group(s))");
      return 0;
    } catch (Exception error) {
      Console.Error.WriteLine(error.Message);
      return 1;
    }
  }
}
