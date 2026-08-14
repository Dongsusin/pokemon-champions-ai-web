param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [ValidateSet('green', 'light')]
  [string]$Background = 'green',

  [ValidateRange(128, 2048)]
  [int]$CanvasSize = 512
)

Add-Type -AssemblyName System.Drawing

if (-not ('TrainerSpritePreparer' -as [type])) {
  Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class TrainerSpritePreparer
{
    private static bool IsBackground(byte blue, byte green, byte red, string mode, bool relaxed)
    {
        if (mode == "green")
        {
            int margin = relaxed ? 34 : 66;
            int minimumGreen = relaxed ? 72 : 118;
            return green >= minimumGreen && green - red >= margin && green - blue >= margin;
        }

        int maximum = Math.Max(red, Math.Max(green, blue));
        int minimum = Math.Min(red, Math.Min(green, blue));
        int brightness = (red + green + blue) / 3;
        int minimumBrightness = relaxed ? 146 : 174;
        int maximumSpread = relaxed ? 54 : 38;
        return brightness >= minimumBrightness && maximum - minimum <= maximumSpread;
    }

    private static void EnqueueIfBackground(
        int x,
        int y,
        int width,
        int height,
        int stride,
        byte[] pixels,
        bool[] background,
        Queue<int> queue,
        string mode,
        bool relaxed)
    {
        if (x < 0 || x >= width || y < 0 || y >= height)
        {
            return;
        }

        int index = y * width + x;
        if (background[index])
        {
            return;
        }

        int offset = y * stride + x * 4;
        if (!IsBackground(pixels[offset], pixels[offset + 1], pixels[offset + 2], mode, relaxed))
        {
            return;
        }

        background[index] = true;
        queue.Enqueue(index);
    }

    public static void Prepare(string sourcePath, string outputPath, string mode, int canvasSize)
    {
        using (Bitmap loaded = new Bitmap(sourcePath))
        using (Bitmap working = new Bitmap(loaded.Width, loaded.Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics graphics = Graphics.FromImage(working))
            {
                graphics.CompositingMode = CompositingMode.SourceCopy;
                graphics.DrawImageUnscaled(loaded, 0, 0);
            }

            Rectangle rectangle = new Rectangle(0, 0, working.Width, working.Height);
            BitmapData bitmapData = working.LockBits(rectangle, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int byteCount = Math.Abs(bitmapData.Stride) * working.Height;
            byte[] pixels = new byte[byteCount];
            Marshal.Copy(bitmapData.Scan0, pixels, 0, byteCount);

            bool[] background = new bool[working.Width * working.Height];
            Queue<int> queue = new Queue<int>(working.Width * 4 + working.Height * 4);

            for (int x = 0; x < working.Width; x++)
            {
                EnqueueIfBackground(x, 0, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
                EnqueueIfBackground(x, working.Height - 1, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
            }

            for (int y = 0; y < working.Height; y++)
            {
                EnqueueIfBackground(0, y, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
                EnqueueIfBackground(working.Width - 1, y, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
            }

            while (queue.Count > 0)
            {
                int index = queue.Dequeue();
                int x = index % working.Width;
                int y = index / working.Width;
                EnqueueIfBackground(x - 1, y, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
                EnqueueIfBackground(x + 1, y, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
                EnqueueIfBackground(x, y - 1, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
                EnqueueIfBackground(x, y + 1, working.Width, working.Height, bitmapData.Stride, pixels, background, queue, mode, false);
            }

            for (int pass = 0; pass < 3; pass++)
            {
                bool[] additions = new bool[background.Length];
                for (int y = 1; y < working.Height - 1; y++)
                {
                    for (int x = 1; x < working.Width - 1; x++)
                    {
                        int index = y * working.Width + x;
                        if (background[index])
                        {
                            continue;
                        }

                        bool touchesBackground = background[index - 1]
                            || background[index + 1]
                            || background[index - working.Width]
                            || background[index + working.Width];
                        if (!touchesBackground)
                        {
                            continue;
                        }

                        int offset = y * bitmapData.Stride + x * 4;
                        additions[index] = IsBackground(
                            pixels[offset],
                            pixels[offset + 1],
                            pixels[offset + 2],
                            mode,
                            true);
                    }
                }

                for (int index = 0; index < additions.Length; index++)
                {
                    background[index] = background[index] || additions[index];
                }
            }

            int minimumX = working.Width;
            int minimumY = working.Height;
            int maximumX = -1;
            int maximumY = -1;

            for (int y = 0; y < working.Height; y++)
            {
                for (int x = 0; x < working.Width; x++)
                {
                    int index = y * working.Width + x;
                    int offset = y * bitmapData.Stride + x * 4;
                    if (background[index])
                    {
                        pixels[offset + 3] = 0;
                        continue;
                    }

                    pixels[offset + 3] = 255;
                    minimumX = Math.Min(minimumX, x);
                    minimumY = Math.Min(minimumY, y);
                    maximumX = Math.Max(maximumX, x);
                    maximumY = Math.Max(maximumY, y);
                }
            }

            Marshal.Copy(pixels, 0, bitmapData.Scan0, byteCount);
            working.UnlockBits(bitmapData);

            if (maximumX < minimumX || maximumY < minimumY)
            {
                throw new InvalidOperationException("No foreground pixels remained after background removal.");
            }

            Rectangle sourceRectangle = Rectangle.FromLTRB(minimumX, minimumY, maximumX + 1, maximumY + 1);
            int horizontalPadding = Math.Max(12, canvasSize / 20);
            int topPadding = Math.Max(12, canvasSize / 24);
            int bottomPadding = Math.Max(8, canvasSize / 32);
            int availableWidth = canvasSize - horizontalPadding * 2;
            int availableHeight = canvasSize - topPadding - bottomPadding;
            double scale = Math.Min(
                (double)availableWidth / sourceRectangle.Width,
                (double)availableHeight / sourceRectangle.Height);
            int destinationWidth = Math.Max(1, (int)Math.Round(sourceRectangle.Width * scale));
            int destinationHeight = Math.Max(1, (int)Math.Round(sourceRectangle.Height * scale));
            int destinationX = (canvasSize - destinationWidth) / 2;
            int destinationY = canvasSize - bottomPadding - destinationHeight;

            using (Bitmap output = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb))
            using (Graphics graphics = Graphics.FromImage(output))
            {
                graphics.Clear(Color.Transparent);
                graphics.CompositingMode = CompositingMode.SourceCopy;
                graphics.CompositingQuality = CompositingQuality.HighSpeed;
                graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
                graphics.PixelOffsetMode = PixelOffsetMode.Half;
                graphics.SmoothingMode = SmoothingMode.None;
                graphics.DrawImage(
                    working,
                    new Rectangle(destinationX, destinationY, destinationWidth, destinationHeight),
                    sourceRectangle,
                    GraphicsUnit.Pixel);

                string directory = Path.GetDirectoryName(outputPath);
                if (!String.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                output.Save(outputPath, ImageFormat.Png);
            }
        }
    }
}
'@
}

$resolvedSourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
[TrainerSpritePreparer]::Prepare($resolvedSourcePath, $resolvedOutputPath, $Background, $CanvasSize)
Write-Output $resolvedOutputPath
