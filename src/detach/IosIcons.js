/**
 *  @flow
 */
import path from 'path';

import { saveImageToPathAsync, saveUrlToPathAsync, spawnAsyncThrowError } from './ExponentTools';
import StandaloneContext from './StandaloneContext';

function _getAppleIconQualifier(iconSize: number, iconResolution: number): string {
  let iconQualifier;
  if (iconResolution !== 1) {
    // e.g. "29x29@3x"
    iconQualifier = `${iconSize}x${iconSize}@${iconResolution}x`;
  } else {
    iconQualifier = `${iconSize}x${iconSize}`;
  }
  if (iconSize === 76 || iconSize === 83.5) {
    // ipad sizes require ~ipad at the end
    iconQualifier = `${iconQualifier}~ipad`;
  }
  return iconQualifier;
}

async function _saveDefaultIconToPathAsync(context: StandaloneContext, path: string) {
  if (context.type === 'user') {
    if (context.data.exp.icon) {
      await saveImageToPathAsync(context.data.projectPath, context.data.exp.icon, path);
    } else {
      throw new Error('Cannot save icon because app.json has no exp.icon key.');
    }
  } else {
    if (context.data.manifest.ios && context.data.manifest.ios.iconUrl) {
      await saveUrlToPathAsync(context.data.manifest.ios.iconUrl, path);
    } else if (context.data.manifest.iconUrl) {
      await saveUrlToPathAsync(context.data.manifest.iconUrl, path);
    } else {
      throw new Error('Cannot save icon because manifest has no iconUrl or ios.iconUrl key.');
    }
  }
  return;
}

/**
 * Based on keys in the given context.config,
 * ensure that the proper iOS icon images exist -- assuming Info.plist already
 * points at them under CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.
 *
 * This only works on MacOS (as far as I know) because it uses the sips utility.
 */
async function createAndWriteIconsToPathAsync(
  context: StandaloneContext,
  destinationIconPath: string
) {
  if (process.platform !== 'darwin') {
    console.warn('`sips` utility may or may not work outside of macOS');
  }
  let defaultIconFilename = 'exp-icon.png';
  try {
    await _saveDefaultIconToPathAsync(context, path.join(destinationIconPath, defaultIconFilename));
  } catch (e) {
    defaultIconFilename = null;
    console.warn(e.message);
  }

  let iconSizes = [1024, 20, 29, 40, 60, 76, 83.5];
  iconSizes.forEach(iconSize => {
    let iconResolutions;
    if (iconSize === 76) {
      // iPad has 1x and 2x icons for this size only
      iconResolutions = [1, 2];
    } else if (iconSize == 1024) {
      // marketing icon is weird
      iconResolutions = [1];
    } else {
      iconResolutions = [2, 3];
    }
    iconResolutions.forEach(async iconResolution => {
      let iconQualifier = _getAppleIconQualifier(iconSize, iconResolution);
      let iconKey = `iconUrl${iconQualifier}`;
      let rawIconFilename;
      let usesDefault = false;
      if (context.type === 'service') {
        // TODO(nikki): Support local paths for these icons
        const manifest = context.data.manifest;
        if (manifest.ios && manifest.ios.hasOwnProperty(iconKey)) {
          // manifest specifies an image just for this size/resolution, use that
          rawIconFilename = `exp-icon${iconQualifier}.png`;
          await saveUrlToPathAsync(
            manifest.ios[iconKey],
            `${destinationIconPath}/${rawIconFilename}`
          );
        }
      }
      if (!rawIconFilename) {
        // use default iconUrl
        usesDefault = true;
        if (defaultIconFilename) {
          rawIconFilename = defaultIconFilename;
        } else {
          console.warn(
            `Project does not specify ios.${iconKey} nor a default iconUrl. Bundle will use the Expo logo.`
          );
          return;
        }
      }

      let iconFilename = `AppIcon${iconQualifier}.png`;
      let iconSizePx = iconSize * iconResolution;
      await spawnAsyncThrowError('/bin/cp', [rawIconFilename, iconFilename], {
        stdio: 'inherit',
        cwd: destinationIconPath,
      });
      try {
        await spawnAsyncThrowError('sips', ['-Z', iconSizePx, iconFilename], {
          stdio: ['ignore', 'ignore', 'inherit'], // only stderr
          cwd: destinationIconPath,
        });
      } catch (e) {
        throw new Error(`Failed to resize image: ${iconFilename}. (${e})`);
      }

      // reject non-square icons (because Apple will if we don't)
      const dims = await getImageDimensionsMacOSAsync(destinationIconPath, iconFilename);
      if (!dims || dims.length < 2 || dims[0] !== dims[1]) {
        throw new Error(`iOS icons must be square, the dimensions of ${iconFilename} are ${dims}`);
      }

      if (!usesDefault) {
        // non-default icon used, clean up the downloaded version
        await spawnAsyncThrowError('/bin/rm', [path.join(destinationIconPath, rawIconFilename)]);
      }
    });
  });

  // clean up default icon
  if (defaultIconFilename) {
    await spawnAsyncThrowError('/bin/rm', [path.join(destinationIconPath, defaultIconFilename)]);
  }
  return;
}

/**
 *  @return array [ width, height ] or nil if that fails for some reason.
 */
async function getImageDimensionsMacOSAsync(dirname: string, basename: string) {
  if (process.platform !== 'darwin') {
    console.warn('`sips` utility may or may not work outside of macOS');
  }
  let dimensions;
  try {
    let childProcess = await spawnAsyncThrowError(
      'sips',
      ['-g', 'pixelWidth', '-g', 'pixelHeight', basename],
      {
        cwd: dirname,
      }
    );
    // stdout looks something like 'pixelWidth: 1200\n pixelHeight: 800'
    const components = childProcess.stdout.split(/(\s+)/);
    dimensions = components.map(c => parseInt(c, 10)).filter(n => !isNaN(n));
  } catch (_) {}
  return dimensions;
}

export { createAndWriteIconsToPathAsync, getImageDimensionsMacOSAsync };
